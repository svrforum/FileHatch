package handlers

import (
	"net/http"
	"os"
	"strings"

	"github.com/labstack/echo/v4"
)

const defaultRhwpStudioURL = "https://edwardkim.github.io/rhwp/"

// GetRhwpSettings returns rhwp HWP viewer/editor configuration for the frontend.
// studioUrl 은 사용자 브라우저가 iframe 으로 로드하는 정적 자산 경로다.
// 폐쇄망/self-host 시 RHWP_STUDIO_URL 환경 변수로 대체할 수 있다.
func (h *Handler) GetRhwpSettings(c echo.Context) error {
	studioURL := strings.TrimSpace(os.Getenv("RHWP_STUDIO_URL"))
	if studioURL == "" {
		studioURL = defaultRhwpStudioURL
	}
	if !strings.HasSuffix(studioURL, "/") {
		studioURL += "/"
	}

	return c.JSON(http.StatusOK, map[string]any{
		"enabled":   true,
		"studioUrl": studioURL,
	})
}
