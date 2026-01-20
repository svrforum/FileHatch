package main

// Version information
// These can be overridden at build time using ldflags:
// go build -ldflags "-X main.Version=1.0.0 -X main.BuildTime=2024-01-01 -X main.GitCommit=abc123"
var (
	Version   = "0.2.12"
	BuildTime = ""
	GitCommit = ""
)

// VersionInfo holds version information for API responses
type VersionInfo struct {
	Version   string `json:"version"`
	BuildTime string `json:"build_time,omitempty"`
	GitCommit string `json:"git_commit,omitempty"`
}

// GetVersionInfo returns the current version information
func GetVersionInfo() VersionInfo {
	return VersionInfo{
		Version:   Version,
		BuildTime: BuildTime,
		GitCommit: GitCommit,
	}
}
