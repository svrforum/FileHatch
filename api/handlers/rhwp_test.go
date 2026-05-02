package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
)

// 환경 변수 미설정 시 — opt-in 정책: enabled=false, studioUrl=""
func TestGetRhwpSettings_DisabledByDefault(t *testing.T) {
	t.Setenv("RHWP_STUDIO_URL", "")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/rhwp/settings", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h := &Handler{}
	if err := h.GetRhwpSettings(c); err != nil {
		t.Fatalf("handler returned error: %v", err)
	}

	assert.Equal(t, http.StatusOK, rec.Code)

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	assert.Equal(t, false, body["enabled"])
	assert.Equal(t, "", body["studioUrl"])
}

// RHWP_STUDIO_URL 명시 시 — enabled=true, 지정한 URL 반환
func TestGetRhwpSettings_EnabledViaEnv(t *testing.T) {
	t.Setenv("RHWP_STUDIO_URL", "/rhwp/")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/rhwp/settings", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h := &Handler{}
	if err := h.GetRhwpSettings(c); err != nil {
		t.Fatalf("handler returned error: %v", err)
	}

	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	assert.Equal(t, true, body["enabled"])
	assert.Equal(t, "/rhwp/", body["studioUrl"])
}

// trailing-slash 정규화 동작 확인
func TestGetRhwpSettings_AddsTrailingSlashWhenMissing(t *testing.T) {
	t.Setenv("RHWP_STUDIO_URL", "https://hwp.example.com")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/rhwp/settings", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h := &Handler{}
	if err := h.GetRhwpSettings(c); err != nil {
		t.Fatalf("handler returned error: %v", err)
	}

	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	assert.Equal(t, true, body["enabled"])
	assert.Equal(t, "https://hwp.example.com/", body["studioUrl"])
}
