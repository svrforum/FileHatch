package handlers

import (
	"net/http"
	"os"
	"strings"

	"github.com/labstack/echo/v4"
)

// GetRhwpSettings returns rhwp HWP viewer/editor configuration for the frontend.
//
// **v0.14.1 — 일시 비활성화**:
// rhwp v0.7.x 는 iframe 임베드 환경에서 wasm-bindgen 초기화 race 로 loadFile 호출이
// __wbindgen_malloc undefined 또는 timeout 으로 안정적이지 않습니다 (rhwp 라이브러리
// 내부 문제로 외부에서 안정화 불가). 추가로 외부 CDN 사용 시 Chrome Private Network
// Access 정책으로 LAN HTTP 환경에서 자원 접근 차단됩니다.
//
// 따라서 RHWP_STUDIO_URL 환경 변수를 명시한 사용자만 활성화하는 opt-in 방식으로
// 변경했습니다. rhwp v1.0 도달 또는 race 해소 후 기본 활성화로 환원 예정입니다.
//
// 활성화 방법:
//
//	RHWP_STUDIO_URL=/rhwp/                              # self-hosted (UI 컨테이너에 mirror)
//	RHWP_STUDIO_URL=https://edwardkim.github.io/rhwp/   # 외부 CDN (LAN HTTP 환경 비권장)
//	RHWP_STUDIO_URL=https://my-internal-host/rhwp/      # 내부 self-host
func (h *Handler) GetRhwpSettings(c echo.Context) error {
	studioURL := strings.TrimSpace(os.Getenv("RHWP_STUDIO_URL"))
	if studioURL == "" {
		return c.JSON(http.StatusOK, map[string]any{
			"enabled":   false,
			"studioUrl": "",
		})
	}
	if !strings.HasSuffix(studioURL, "/") {
		studioURL += "/"
	}

	return c.JSON(http.StatusOK, map[string]any{
		"enabled":   true,
		"studioUrl": studioURL,
	})
}
