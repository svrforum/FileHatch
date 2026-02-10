package handlers

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	smithy "github.com/aws/smithy-go"
)

// S3Config holds configuration for S3-compatible storage
type S3Config struct {
	Endpoint       string `json:"endpoint"`
	Region         string `json:"region"`
	Bucket         string `json:"bucket"`
	AccessKeyID    string `json:"access_key_id"`
	SecretAccessKey string `json:"secret_access_key"`
	PathStyle      bool   `json:"path_style"` // MinIO/Ceph: true, AWS: false
	Prefix         string `json:"prefix"`     // Key prefix within bucket
}

// S3Backend implements StorageBackend for S3-compatible storage
type S3Backend struct {
	client *s3.Client
	bucket string
	prefix string // prefix without trailing slash
}

// NewS3Backend creates a new S3Backend from configuration
func NewS3Backend(cfg S3Config) (*S3Backend, error) {
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}
	if cfg.Bucket == "" {
		return nil, fmt.Errorf("bucket is required")
	}

	// Build S3 client options
	opts := func(o *s3.Options) {
		o.Region = cfg.Region
		o.Credentials = credentials.NewStaticCredentialsProvider(
			cfg.AccessKeyID, cfg.SecretAccessKey, "",
		)
		if cfg.Endpoint != "" {
			o.BaseEndpoint = aws.String(cfg.Endpoint)
		}
		if cfg.PathStyle {
			o.UsePathStyle = true
		}
	}

	client := s3.New(s3.Options{}, opts)

	prefix := strings.TrimSuffix(cfg.Prefix, "/")

	return &S3Backend{
		client: client,
		bucket: cfg.Bucket,
		prefix: prefix,
	}, nil
}

// key converts a relative path to an S3 object key
func (b *S3Backend) key(relPath string) string {
	relPath = strings.TrimPrefix(relPath, "/")
	if b.prefix != "" {
		if relPath == "" {
			return b.prefix + "/"
		}
		return b.prefix + "/" + relPath
	}
	if relPath == "" {
		return ""
	}
	return relPath
}

// Type returns "s3"
func (b *S3Backend) Type() string { return "s3" }

// IsLocal returns false
func (b *S3Backend) IsLocal() bool { return false }

// Stat returns info about an object or "directory"
func (b *S3Backend) Stat(ctx context.Context, relPath string) (*StorageFileInfo, error) {
	key := b.key(relPath)

	// Try HeadObject first (for files)
	if key != "" && !strings.HasSuffix(key, "/") {
		out, err := b.client.HeadObject(ctx, &s3.HeadObjectInput{
			Bucket: aws.String(b.bucket),
			Key:    aws.String(key),
		})
		if err == nil {
			modTime := time.Time{}
			if out.LastModified != nil {
				modTime = *out.LastModified
			}
			size := int64(0)
			if out.ContentLength != nil {
				size = *out.ContentLength
			}
			return &StorageFileInfo{
				FileName:    path.Base(relPath),
				FileSize:    size,
				IsDirectory: false,
				FileModTime: modTime,
				FileMode:    0644,
			}, nil
		}
	}

	// Check if it's a "directory" by listing with prefix
	dirKey := key
	if dirKey != "" && !strings.HasSuffix(dirKey, "/") {
		dirKey += "/"
	}

	out, err := b.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket:    aws.String(b.bucket),
		Prefix:    aws.String(dirKey),
		MaxKeys:   aws.Int32(1),
		Delimiter: aws.String("/"),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to stat path: %w", err)
	}

	if len(out.Contents) > 0 || len(out.CommonPrefixes) > 0 {
		name := path.Base(relPath)
		if name == "" || name == "." {
			name = path.Base(b.prefix)
		}
		return &StorageFileInfo{
			FileName:    name,
			FileSize:    0,
			IsDirectory: true,
			FileModTime: time.Now(),
			FileMode:    0755,
		}, nil
	}

	return nil, fmt.Errorf("%w: %s", ErrStorageNotFound, relPath)
}

// List returns directory entries at the given path
func (b *S3Backend) List(ctx context.Context, relPath string) ([]StorageDirEntry, error) {
	return b.ReadDir(ctx, relPath)
}

// ReadDir returns directory entries at the given path
func (b *S3Backend) ReadDir(ctx context.Context, relPath string) ([]StorageDirEntry, error) {
	prefix := b.key(relPath)
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}

	var entries []StorageDirEntry
	paginator := s3.NewListObjectsV2Paginator(b.client, &s3.ListObjectsV2Input{
		Bucket:    aws.String(b.bucket),
		Prefix:    aws.String(prefix),
		Delimiter: aws.String("/"),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list objects: %w", err)
		}

		// Directories (common prefixes)
		for _, cp := range page.CommonPrefixes {
			name := strings.TrimSuffix(strings.TrimPrefix(*cp.Prefix, prefix), "/")
			if name == "" {
				continue
			}
			entries = append(entries, StorageDirEntry{
				EntryName: name,
				IsDir:     true,
				Info: &StorageFileInfo{
					FileName:    name,
					FileSize:    0,
					IsDirectory: true,
					FileModTime: time.Now(),
					FileMode:    0755,
				},
			})
		}

		// Files
		for _, obj := range page.Contents {
			name := strings.TrimPrefix(*obj.Key, prefix)
			if name == "" || strings.HasSuffix(name, "/") {
				continue // skip "directory marker" objects
			}
			modTime := time.Time{}
			if obj.LastModified != nil {
				modTime = *obj.LastModified
			}
			size := int64(0)
			if obj.Size != nil {
				size = *obj.Size
			}
			entries = append(entries, StorageDirEntry{
				EntryName: name,
				IsDir:     false,
				Info: &StorageFileInfo{
					FileName:    name,
					FileSize:    size,
					IsDirectory: false,
					FileModTime: modTime,
					FileMode:    0644,
				},
			})
		}
	}

	return entries, nil
}

// ReadFile opens an S3 object for reading
func (b *S3Backend) ReadFile(ctx context.Context, relPath string) (io.ReadCloser, *StorageFileInfo, error) {
	key := b.key(relPath)
	out, err := b.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) && apiErr.ErrorCode() == "NoSuchKey" {
			return nil, nil, fmt.Errorf("%w: %s", ErrStorageNotFound, relPath)
		}
		return nil, nil, fmt.Errorf("failed to get object: %w", err)
	}

	modTime := time.Time{}
	if out.LastModified != nil {
		modTime = *out.LastModified
	}
	size := int64(0)
	if out.ContentLength != nil {
		size = *out.ContentLength
	}

	info := &StorageFileInfo{
		FileName:    path.Base(relPath),
		FileSize:    size,
		IsDirectory: false,
		FileModTime: modTime,
		FileMode:    0644,
	}

	return out.Body, info, nil
}

// WriteFile uploads content to S3
func (b *S3Backend) WriteFile(ctx context.Context, relPath string, reader io.Reader, size int64) error {
	key := b.key(relPath)

	// For small files or unknown size, use PutObject
	// For large files (>100MB), use multipart upload
	const multipartThreshold = 100 * 1024 * 1024 // 100MB

	if size > 0 && size > multipartThreshold {
		return b.multipartUpload(ctx, key, reader, size)
	}

	// S3 PutObject requires a seekable reader for payload hash computation.
	// If the reader is not seekable, spool to a temp file to avoid large heap allocations.
	var body io.ReadSeeker
	if rs, ok := reader.(io.ReadSeeker); ok {
		body = rs
	} else {
		tmpFile, err := os.CreateTemp("", "filehatch-s3-upload-*")
		if err != nil {
			return fmt.Errorf("failed to create temp file: %w", err)
		}
		defer os.Remove(tmpFile.Name())
		defer tmpFile.Close()

		written, err := io.Copy(tmpFile, reader)
		if err != nil {
			return fmt.Errorf("failed to spool content to temp file: %w", err)
		}
		if _, err := tmpFile.Seek(0, io.SeekStart); err != nil {
			return fmt.Errorf("failed to seek temp file: %w", err)
		}
		body = tmpFile
		size = written
	}

	input := &s3.PutObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(key),
		Body:   body,
	}
	if size > 0 {
		input.ContentLength = aws.Int64(size)
	}

	_, err := b.client.PutObject(ctx, input)
	if err != nil {
		return fmt.Errorf("failed to put object: %w", err)
	}
	return nil
}

// multipartUpload handles large file uploads using S3 multipart upload
func (b *S3Backend) multipartUpload(ctx context.Context, key string, reader io.Reader, _ int64) error {
	const partSize = 64 * 1024 * 1024 // 64MB parts

	// Create multipart upload
	createOut, err := b.client.CreateMultipartUpload(ctx, &s3.CreateMultipartUploadInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("failed to create multipart upload: %w", err)
	}

	uploadID := createOut.UploadId
	var parts []types.CompletedPart
	partNum := int32(1)
	buf := make([]byte, partSize)

	for {
		n, readErr := io.ReadFull(reader, buf)
		if n == 0 && readErr != nil {
			break
		}

		uploadOut, err := b.client.UploadPart(ctx, &s3.UploadPartInput{
			Bucket:     aws.String(b.bucket),
			Key:        aws.String(key),
			UploadId:   uploadID,
			PartNumber: aws.Int32(partNum),
			Body:       bytes.NewReader(buf[:n]),
		})
		if err != nil {
			// Abort on failure
			_, _ = b.client.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{
				Bucket:   aws.String(b.bucket),
				Key:      aws.String(key),
				UploadId: uploadID,
			})
			return fmt.Errorf("failed to upload part %d: %w", partNum, err)
		}

		parts = append(parts, types.CompletedPart{
			ETag:       uploadOut.ETag,
			PartNumber: aws.Int32(partNum),
		})
		partNum++

		if readErr != nil {
			break
		}
	}

	// Complete multipart upload
	_, err = b.client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket:   aws.String(b.bucket),
		Key:      aws.String(key),
		UploadId: uploadID,
		MultipartUpload: &types.CompletedMultipartUpload{
			Parts: parts,
		},
	})
	if err != nil {
		return fmt.Errorf("failed to complete multipart upload: %w", err)
	}

	return nil
}

// Delete removes a single object
func (b *S3Backend) Delete(ctx context.Context, relPath string) error {
	key := b.key(relPath)
	_, err := b.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("failed to delete object: %w", err)
	}
	return nil
}

// DeleteAll removes all objects under a prefix (recursive delete)
func (b *S3Backend) DeleteAll(ctx context.Context, relPath string) error {
	prefix := b.key(relPath)
	if !strings.HasSuffix(prefix, "/") {
		// Try deleting the exact key (could be a file or directory marker)
		_, _ = b.client.DeleteObject(ctx, &s3.DeleteObjectInput{
			Bucket: aws.String(b.bucket),
			Key:    aws.String(prefix),
		})
		// Always continue to delete objects under the prefix
		prefix += "/"
	}

	// List all objects under prefix and delete in batches
	paginator := s3.NewListObjectsV2Paginator(b.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(b.bucket),
		Prefix: aws.String(prefix),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("failed to list objects for deletion: %w", err)
		}

		if len(page.Contents) == 0 {
			continue
		}

		objects := make([]types.ObjectIdentifier, 0, len(page.Contents))
		for _, obj := range page.Contents {
			objects = append(objects, types.ObjectIdentifier{
				Key: obj.Key,
			})
		}

		_, err = b.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(b.bucket),
			Delete: &types.Delete{
				Objects: objects,
				Quiet:   aws.Bool(true),
			},
		})
		if err != nil {
			return fmt.Errorf("failed to delete objects: %w", err)
		}
	}

	return nil
}

// Mkdir creates a "directory" in S3 by putting an empty object with trailing slash
func (b *S3Backend) Mkdir(ctx context.Context, relPath string) error {
	key := b.key(relPath)
	if !strings.HasSuffix(key, "/") {
		key += "/"
	}
	_, err := b.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(key),
		Body:   bytes.NewReader([]byte{}),
	})
	if err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}
	return nil
}

// Rename renames an object by copying then deleting the original
func (b *S3Backend) Rename(ctx context.Context, oldPath, newPath string) error {
	if err := b.Copy(ctx, oldPath, newPath); err != nil {
		return err
	}
	return b.DeleteAll(ctx, oldPath)
}

// encodeCopySource URL-encodes the S3 CopySource value (bucket/key) segment by segment,
// so that filenames with spaces or special characters are handled correctly.
func encodeCopySource(bucket, key string) string {
	segments := strings.Split(key, "/")
	for i, seg := range segments {
		segments[i] = url.PathEscape(seg)
	}
	return bucket + "/" + strings.Join(segments, "/")
}

// Copy copies an object or "directory" (all objects under prefix)
func (b *S3Backend) Copy(ctx context.Context, srcPath, dstPath string) error {
	srcKey := b.key(srcPath)
	dstKey := b.key(dstPath)

	// Try single object copy first
	_, err := b.client.CopyObject(ctx, &s3.CopyObjectInput{
		Bucket:     aws.String(b.bucket),
		CopySource: aws.String(encodeCopySource(b.bucket, srcKey)),
		Key:        aws.String(dstKey),
	})
	if err == nil {
		return nil
	}

	// If single object copy fails, try recursive copy (directory)
	srcPrefix := srcKey
	if !strings.HasSuffix(srcPrefix, "/") {
		srcPrefix += "/"
	}
	dstPrefix := dstKey
	if !strings.HasSuffix(dstPrefix, "/") {
		dstPrefix += "/"
	}

	paginator := s3.NewListObjectsV2Paginator(b.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(b.bucket),
		Prefix: aws.String(srcPrefix),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("failed to list objects for copy: %w", err)
		}

		for _, obj := range page.Contents {
			relKey := strings.TrimPrefix(*obj.Key, srcPrefix)
			newKey := dstPrefix + relKey
			_, err := b.client.CopyObject(ctx, &s3.CopyObjectInput{
				Bucket:     aws.String(b.bucket),
				CopySource: aws.String(encodeCopySource(b.bucket, *obj.Key)),
				Key:        aws.String(newKey),
			})
			if err != nil {
				return fmt.Errorf("failed to copy %s: %w", *obj.Key, err)
			}
		}
	}

	return nil
}

// Walk walks all objects under a prefix
func (b *S3Backend) Walk(ctx context.Context, root string, walkFn StorageWalkFunc) error {
	prefix := b.key(root)
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}

	// First call walkFn for the root itself
	rootName := path.Base(root)
	if rootName == "" || rootName == "." || rootName == "/" {
		rootName = "."
	}
	walkRoot := root
	if walkRoot == "" {
		walkRoot = "."
	}
	if err := walkFn(walkRoot, &StorageFileInfo{
		FileName:    rootName,
		IsDirectory: true,
		FileModTime: time.Now(),
		FileMode:    0755,
	}, nil); err != nil {
		if err == ErrSkipDir || err == ErrSkipAll {
			return nil
		}
		return err
	}

	// Track seen directories so we can emit virtual entries for intermediate dirs
	// that have no explicit directory marker object in S3.
	seenDirs := make(map[string]bool)

	paginator := s3.NewListObjectsV2Paginator(b.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(b.bucket),
		Prefix: aws.String(prefix),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("failed to list objects for walk: %w", err)
		}

		for _, obj := range page.Contents {
			relPath := strings.TrimPrefix(*obj.Key, prefix)
			if relPath == "" {
				continue
			}

			isDir := strings.HasSuffix(relPath, "/")
			relPath = strings.TrimSuffix(relPath, "/")

			// Emit virtual directory entries for any intermediate directories
			// that haven't been seen yet (S3 flat listing may omit them).
			parts := strings.Split(relPath, "/")
			for i := 1; i < len(parts); i++ {
				dirRel := strings.Join(parts[:i], "/")
				if !seenDirs[dirRel] {
					seenDirs[dirRel] = true
					dirFull := path.Join(root, dirRel)
					dirInfo := &StorageFileInfo{
						FileName:    parts[i-1],
						IsDirectory: true,
						FileModTime: time.Now(),
						FileMode:    0755,
					}
					if err := walkFn(dirFull, dirInfo, nil); err != nil {
						if err == ErrSkipDir {
							continue
						}
						if err == ErrSkipAll {
							return nil
						}
						return err
					}
				}
			}

			if isDir {
				seenDirs[relPath] = true
			}

			modTime := time.Time{}
			if obj.LastModified != nil {
				modTime = *obj.LastModified
			}
			size := int64(0)
			if obj.Size != nil {
				size = *obj.Size
			}

			info := &StorageFileInfo{
				FileName:    path.Base(relPath),
				FileSize:    size,
				IsDirectory: isDir,
				FileModTime: modTime,
				FileMode:    0644,
			}
			if isDir {
				info.FileMode = 0755
			}

			// Pass full path (root + relPath) so callers can use filepath.Rel(root, path)
			// and backend.ReadFile(ctx, path) correctly
			fullPath := path.Join(root, relPath)
			if err := walkFn(fullPath, info, nil); err != nil {
				if err == ErrSkipDir {
					continue
				}
				if err == ErrSkipAll {
					return nil
				}
				return err
			}
		}
	}

	return nil
}

// Exists checks if an object or prefix exists
func (b *S3Backend) Exists(ctx context.Context, relPath string) (bool, error) {
	key := b.key(relPath)

	// Check as object
	if key != "" && !strings.HasSuffix(key, "/") {
		_, err := b.client.HeadObject(ctx, &s3.HeadObjectInput{
			Bucket: aws.String(b.bucket),
			Key:    aws.String(key),
		})
		if err == nil {
			return true, nil
		}
	}

	// Check as directory
	dirKey := key
	if !strings.HasSuffix(dirKey, "/") {
		dirKey += "/"
	}
	out, err := b.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket:  aws.String(b.bucket),
		Prefix:  aws.String(dirKey),
		MaxKeys: aws.Int32(1),
	})
	if err != nil {
		return false, fmt.Errorf("failed to check existence: %w", err)
	}

	return len(out.Contents) > 0, nil
}

// GetRealPath returns ErrNotLocalBackend for S3
func (b *S3Backend) GetRealPath(_ string) (string, error) {
	return "", ErrNotLocalBackend
}

// SetPermissions is a no-op for S3
func (b *S3Backend) SetPermissions(_ context.Context, _ string, _ bool) error {
	return nil // no-op
}

// CalculateSize calculates total size of all objects under a prefix
func (b *S3Backend) CalculateSize(ctx context.Context, relPath string) (int64, error) {
	prefix := b.key(relPath)
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
		// Could be a file
		out, err := b.client.HeadObject(ctx, &s3.HeadObjectInput{
			Bucket: aws.String(b.bucket),
			Key:    aws.String(prefix),
		})
		if err == nil && out.ContentLength != nil {
			return *out.ContentLength, nil
		}
		prefix += "/"
	}

	var totalSize int64
	paginator := s3.NewListObjectsV2Paginator(b.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(b.bucket),
		Prefix: aws.String(prefix),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return 0, fmt.Errorf("failed to calculate size: %w", err)
		}
		for _, obj := range page.Contents {
			if obj.Size != nil {
				totalSize += *obj.Size
			}
		}
	}

	return totalSize, nil
}

// TestConnection tests the S3 connection by listing objects
func (b *S3Backend) TestConnection(ctx context.Context) error {
	_, err := b.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket:  aws.String(b.bucket),
		MaxKeys: aws.Int32(1),
	})
	if err != nil {
		return fmt.Errorf("S3 connection test failed: %w", err)
	}
	return nil
}
