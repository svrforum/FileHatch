package handlers

import (
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/labstack/echo/v4"
)

// SystemInfo represents the server system information
type SystemInfo struct {
	Hostname    string          `json:"hostname"`
	OS          string          `json:"os"`
	Arch        string          `json:"arch"`
	CPUs        int             `json:"cpus"`
	GoVersion   string          `json:"goVersion"`
	Memory      MemoryInfo      `json:"memory"`
	Disk        DiskInfo        `json:"disk"`
	Uptime      string          `json:"uptime"`
	ServerTime  string          `json:"serverTime"`
	DataPath    string          `json:"dataPath"`
	ProjectInfo ProjectInfo     `json:"projectInfo"`
	FolderTree  []FolderStat    `json:"folderTree"`
}

// MemoryInfo represents memory statistics
type MemoryInfo struct {
	Total     uint64  `json:"total"`
	Used      uint64  `json:"used"`
	Free      uint64  `json:"free"`
	UsedPct   float64 `json:"usedPct"`
	Formatted struct {
		Total string `json:"total"`
		Used  string `json:"used"`
		Free  string `json:"free"`
	} `json:"formatted"`
}

// DiskInfo represents disk statistics
type DiskInfo struct {
	Total     uint64  `json:"total"`
	Used      uint64  `json:"used"`
	Free      uint64  `json:"free"`
	UsedPct   float64 `json:"usedPct"`
	Formatted struct {
		Total string `json:"total"`
		Used  string `json:"used"`
		Free  string `json:"free"`
	} `json:"formatted"`
}

// ProjectInfo represents project storage information
type ProjectInfo struct {
	TotalSize     int64  `json:"totalSize"`
	TotalFiles    int    `json:"totalFiles"`
	TotalFolders  int    `json:"totalFolders"`
	UsersCount    int    `json:"usersCount"`
	SharedFolders int    `json:"sharedFolders"`
	Formatted     string `json:"formatted"`
}

// FolderStat represents folder size statistics
type FolderStat struct {
	Name       string       `json:"name"`
	Path       string       `json:"path"`
	Size       int64        `json:"size"`
	Formatted  string       `json:"formatted"`
	FileCount  int          `json:"fileCount"`
	IsDir      bool         `json:"isDir"`
	Children   []FolderStat `json:"children,omitempty"`
	Expanded   bool         `json:"expanded,omitempty"`
}

// GetSystemInfo returns system information
func (h *Handler) GetSystemInfo(c echo.Context) error {
	// Check admin permission
	_, err := RequireAdmin(c)
	if err != nil {
		return err
	}

	hostname, _ := os.Hostname()

	// Get memory info
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	// Get disk info for data path
	diskInfo := getDiskInfo(h.dataRoot)

	// Get memory info from system
	memInfo := getMemoryInfo()

	// Calculate uptime (process start time)
	uptime := time.Since(startTime)

	// Get project statistics
	projectInfo := h.getProjectInfo()

	// Get folder tree (limited depth for performance)
	folderTree := h.getFolderTree(h.dataRoot, 2)

	info := SystemInfo{
		Hostname:    hostname,
		OS:          runtime.GOOS,
		Arch:        runtime.GOARCH,
		CPUs:        runtime.NumCPU(),
		GoVersion:   runtime.Version(),
		Memory:      memInfo,
		Disk:        diskInfo,
		Uptime:      formatDuration(uptime),
		ServerTime:  time.Now().Format("2006-01-02 15:04:05 MST"),
		DataPath:    h.dataRoot,
		ProjectInfo: projectInfo,
		FolderTree:  folderTree,
	}

	return RespondSuccess(c, info)
}

// GetFolderTreeAPI returns folder tree for a specific path
func (h *Handler) GetFolderTreeAPI(c echo.Context) error {
	// Check admin permission
	_, err := RequireAdmin(c)
	if err != nil {
		return err
	}

	path := c.QueryParam("path")
	if path == "" {
		path = h.dataRoot
	}

	// Validate path is within data root
	absPath, pathErr := filepath.Abs(path)
	if pathErr != nil || !strings.HasPrefix(absPath, h.dataRoot) {
		return RespondError(c, ErrInvalidPath("Path must be within data root"))
	}

	depthStr := c.QueryParam("depth")
	depth := 1
	if depthStr != "" {
		if d, parseErr := strconv.Atoi(depthStr); parseErr == nil && d > 0 && d <= 5 {
			depth = d
		}
	}

	tree := h.getFolderTree(absPath, depth)
	return RespondSuccess(c, tree)
}

var startTime = time.Now()

func getMemoryInfo() MemoryInfo {
	var info MemoryInfo

	// Read from /proc/meminfo on Linux
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		// Fallback to Go runtime stats
		var memStats runtime.MemStats
		runtime.ReadMemStats(&memStats)
		info.Total = memStats.Sys
		info.Used = memStats.Alloc
		info.Free = memStats.Sys - memStats.Alloc
	} else {
		lines := strings.Split(string(data), "\n")
		for _, line := range lines {
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}

			value, err := strconv.ParseUint(fields[1], 10, 64)
			if err != nil {
				continue
			}
			value *= 1024 // Convert from KB to bytes

			switch fields[0] {
			case "MemTotal:":
				info.Total = value
			case "MemFree:":
				info.Free = value
			case "MemAvailable:":
				// Use available instead of free if present
				info.Free = value
			case "Buffers:", "Cached:":
				// These are part of "available" memory
			}
		}
		info.Used = info.Total - info.Free
	}

	if info.Total > 0 {
		info.UsedPct = float64(info.Used) / float64(info.Total) * 100
	}

	info.Formatted.Total = formatBytes(int64(info.Total))
	info.Formatted.Used = formatBytes(int64(info.Used))
	info.Formatted.Free = formatBytes(int64(info.Free))

	return info
}

func getDiskInfo(path string) DiskInfo {
	var info DiskInfo

	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err == nil {
		info.Total = stat.Blocks * uint64(stat.Bsize)
		info.Free = stat.Bavail * uint64(stat.Bsize)
		info.Used = info.Total - info.Free

		if info.Total > 0 {
			info.UsedPct = float64(info.Used) / float64(info.Total) * 100
		}
	}

	info.Formatted.Total = formatBytes(int64(info.Total))
	info.Formatted.Used = formatBytes(int64(info.Used))
	info.Formatted.Free = formatBytes(int64(info.Free))

	return info
}

func (h *Handler) getProjectInfo() ProjectInfo {
	var info ProjectInfo

	// Count users
	var userCount int
	h.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&userCount)
	info.UsersCount = userCount

	// Count shared folders
	var sharedCount int
	h.db.QueryRow("SELECT COUNT(*) FROM shared_folders WHERE is_active = true").Scan(&sharedCount)
	info.SharedFolders = sharedCount

	// Calculate total size and file count
	filepath.Walk(h.dataRoot, func(path string, fi os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if fi.IsDir() {
			info.TotalFolders++
		} else {
			info.TotalFiles++
			info.TotalSize += fi.Size()
		}
		return nil
	})

	info.Formatted = formatBytes(info.TotalSize)

	return info
}

func (h *Handler) getFolderTree(rootPath string, maxDepth int) []FolderStat {
	var result []FolderStat

	entries, err := os.ReadDir(rootPath)
	if err != nil {
		return result
	}

	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue // Skip hidden files
		}

		fullPath := filepath.Join(rootPath, entry.Name())
		stat := FolderStat{
			Name:  entry.Name(),
			Path:  fullPath,
			IsDir: entry.IsDir(),
		}

		if entry.IsDir() {
			stat.Size, stat.FileCount = calculateDirSize(fullPath)
			stat.Formatted = formatBytes(stat.Size)

			if maxDepth > 1 {
				stat.Children = h.getFolderTree(fullPath, maxDepth-1)
			}
		} else {
			if info, err := entry.Info(); err == nil {
				stat.Size = info.Size()
				stat.Formatted = formatBytes(stat.Size)
				stat.FileCount = 1
			}
		}

		result = append(result, stat)
	}

	// Sort by size descending
	sort.Slice(result, func(i, j int) bool {
		return result[i].Size > result[j].Size
	})

	return result
}

func calculateDirSize(path string) (int64, int) {
	var size int64
	var count int

	filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() {
			size += info.Size()
			count++
		}
		return nil
	})

	return size, count
}

func formatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return strconv.FormatInt(bytes, 10) + " B"
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	sizes := []string{"KB", "MB", "GB", "TB", "PB"}
	return strconv.FormatFloat(float64(bytes)/float64(div), 'f', 2, 64) + " " + sizes[exp]
}

func formatDuration(d time.Duration) string {
	d = d.Round(time.Second)
	days := int(d.Hours() / 24)
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60
	seconds := int(d.Seconds()) % 60

	if days > 0 {
		return strconv.Itoa(days) + "d " + strconv.Itoa(hours) + "h " + strconv.Itoa(minutes) + "m"
	}
	if hours > 0 {
		return strconv.Itoa(hours) + "h " + strconv.Itoa(minutes) + "m " + strconv.Itoa(seconds) + "s"
	}
	if minutes > 0 {
		return strconv.Itoa(minutes) + "m " + strconv.Itoa(seconds) + "s"
	}
	return strconv.Itoa(seconds) + "s"
}
