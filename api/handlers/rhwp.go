package handlers

import (
	"net/http"
	"os"
	"strings"

	"github.com/labstack/echo/v4"
)

// GetRhwpSettings returns rhwp HWP viewer/editor configuration for the frontend.
//
// **v0.15.0**: rhwp v0.7.10 의 wasm 초기화 race fix (PR #581 by @oksure) 가 반영되어
// 기본 활성화로 환원. RHWP_STUDIO_URL 미설정 시 UI 컨테이너 self-host `/rhwp/` 를 사용.
//
// 환경변수 override 예:
//
//	RHWP_STUDIO_URL=https://edwardkim.github.io/rhwp/   # 외부 CDN (PNA 환경 비권장)
//	RHWP_STUDIO_URL=https://my-internal-host/rhwp/      # 내부 self-host
func (h *Handler) GetRhwpSettings(c echo.Context) error {
	studioURL := strings.TrimSpace(os.Getenv("RHWP_STUDIO_URL"))
	if studioURL == "" {
		// v0.15.0: race 해소로 기본 활성, UI 컨테이너 self-host /rhwp/ 사용
		studioURL = "/rhwp/"
	}
	if !strings.HasSuffix(studioURL, "/") {
		studioURL += "/"
	}
	return c.JSON(http.StatusOK, map[string]any{
		"enabled":   true,
		"studioUrl": studioURL,
	})
}
