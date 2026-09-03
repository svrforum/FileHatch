package handlers

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

func TestShareHandler_DownloadShare(t *testing.T) {
	passwordHash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	tests := []struct {
		name           string
		password       string
		expectedStatus int
		expectZip      bool
	}{
		{
			name:           "password protected folder downloads as zip",
			password:       "correct-password",
			expectedStatus: http.StatusOK,
			expectZip:      true,
		},
		{
			name:           "invalid password is rejected before zip streaming",
			password:       "wrong-password",
			expectedStatus: http.StatusUnauthorized,
			expectZip:      false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dataRoot := t.TempDir()
			sharePath := filepath.Join("shared", "documents")
			sharedDirectory := filepath.Join(dataRoot, sharePath)
			if err := os.MkdirAll(filepath.Join(sharedDirectory, "nested"), 0o755); err != nil {
				t.Fatalf("create shared directory: %v", err)
			}
			if err := os.WriteFile(
				filepath.Join(sharedDirectory, "nested", "report.txt"),
				[]byte("shared folder contents"),
				0o600,
			); err != nil {
				t.Fatalf("write shared file: %v", err)
			}

			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("create sql mock: %v", err)
			}
			defer db.Close()

			query := "SELECT path, password_hash, expires_at, access_count, max_access, " +
				"is_active, require_login, created_by"
			mock.ExpectQuery(query).
				WithArgs("share-token").
				WillReturnRows(downloadShareRows(sharePath, passwordHash))

			e := echo.New()
			req := httptest.NewRequest(
				http.MethodGet,
				"/api/s/share-token/download?password="+tt.password,
				nil,
			)
			recorder := httptest.NewRecorder()
			ctx := e.NewContext(req, recorder)
			ctx.SetParamNames("token")
			ctx.SetParamValues("share-token")

			handler := NewShareHandler(db, dataRoot, nil, nil, nil)
			if err := handler.DownloadShare(ctx); err != nil {
				t.Fatalf("download share: %v", err)
			}

			if recorder.Code != tt.expectedStatus {
				t.Fatalf("status = %d, want %d; body=%s", recorder.Code, tt.expectedStatus, recorder.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("database expectations: %v", err)
			}

			if !tt.expectZip {
				if got := recorder.Header().Get(echo.HeaderContentType); strings.Contains(got, "application/zip") {
					t.Fatalf("content type = %q, must not start ZIP response", got)
				}
				return
			}

			assertSharedFolderZip(t, recorder)
		})
	}
}

func downloadShareRows(path string, passwordHash []byte) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"path",
		"password_hash",
		"expires_at",
		"access_count",
		"max_access",
		"is_active",
		"require_login",
		"created_by",
	}).AddRow(
		path,
		string(passwordHash),
		sql.NullTime{},
		0,
		sql.NullInt32{},
		true,
		false,
		"owner-id",
	)
}

func assertSharedFolderZip(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()

	if got := recorder.Header().Get(echo.HeaderContentType); got != "application/zip" {
		t.Fatalf("content type = %q, want application/zip", got)
	}
	if got := recorder.Header().Get(echo.HeaderContentDisposition); !strings.Contains(got, "documents.zip") {
		t.Fatalf("content disposition = %q, want documents.zip", got)
	}

	reader, err := zip.NewReader(bytes.NewReader(recorder.Body.Bytes()), int64(recorder.Body.Len()))
	if err != nil {
		t.Fatalf("open ZIP response: %v", err)
	}

	entries := make(map[string]*zip.File, len(reader.File))
	for _, file := range reader.File {
		entries[file.Name] = file
	}

	if _, ok := entries["documents/"]; !ok {
		t.Fatal("ZIP does not contain shared folder root")
	}
	file, ok := entries["documents/nested/report.txt"]
	if !ok {
		t.Fatal("ZIP does not contain nested shared file")
	}

	contents, err := readZipFile(file)
	if err != nil {
		t.Fatalf("read ZIP file: %v", err)
	}
	if got, want := string(contents), "shared folder contents"; got != want {
		t.Fatalf("ZIP file contents = %q, want %q", got, want)
	}
}

func readZipFile(file *zip.File) ([]byte, error) {
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	return io.ReadAll(reader)
}
