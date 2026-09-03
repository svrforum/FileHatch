package appconfig

import (
	"os"
	"strings"
)

const (
	defaultDataRoot              = "/data"
	defaultConfigPath            = "/etc/filehatch"
	defaultAPIInternalURL        = "http://api:8080"
	defaultOnlyOfficeInternalURL = "http://onlyoffice"
)

var developmentOrigins = []string{
	"http://localhost:3000",
	"http://localhost:3080",
	"http://localhost:5173",
	"http://127.0.0.1:3000",
	"http://127.0.0.1:3080",
	"http://127.0.0.1:5173",
}

// IsProduction은 운영 환경의 보안 정책 적용 여부를 반환한다.
func IsProduction() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("FH_ENV")), "production")
}

// DataRoot는 관리 대상 파일 데이터의 루트 경로를 반환한다.
func DataRoot() string {
	return envOrDefault("DATA_ROOT", defaultDataRoot)
}

// ConfigPath는 생성된 서비스 설정을 저장하는 경로를 반환한다.
func ConfigPath() string {
	return envOrDefault("CONFIG_PATH", defaultConfigPath)
}

// APIInternalURL은 다른 컨테이너가 API에 접근할 내부 URL을 반환한다.
func APIInternalURL() string {
	return urlEnvOrDefault("API_INTERNAL_URL", defaultAPIInternalURL)
}

// OnlyOfficeInternalURL은 API가 OnlyOffice에 접근할 내부 URL을 반환한다.
func OnlyOfficeInternalURL() string {
	return urlEnvOrDefault("ONLYOFFICE_INTERNAL_URL", defaultOnlyOfficeInternalURL)
}

// AllowedOrigins는 HTTP와 WebSocket이 공유하는 origin 허용 목록을 반환한다.
func AllowedOrigins() []string {
	rawOrigins := os.Getenv("CORS_ALLOWED_ORIGINS")
	if rawOrigins == "" {
		// ALLOWED_ORIGINS는 한 릴리스 동안 호환 alias로 유지한다.
		rawOrigins = os.Getenv("ALLOWED_ORIGINS")
	}
	if rawOrigins != "" {
		return parseList(rawOrigins)
	}
	if IsProduction() {
		return []string{}
	}

	origins := make([]string, len(developmentOrigins))
	copy(origins, developmentOrigins)
	return origins
}

func envOrDefault(name, defaultValue string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return defaultValue
	}
	return value
}

func urlEnvOrDefault(name, defaultValue string) string {
	return strings.TrimRight(envOrDefault(name, defaultValue), "/")
}

func parseList(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, strings.TrimRight(trimmed, "/"))
		}
	}
	return result
}
