package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
)

func newRhwpHandler() *Handler { return &Handler{} }

func TestGetRhwpSettings_DefaultsToLocalMirror(t *testing.T) {
	t.Setenv("RHWP_STUDIO_URL", "")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/rhwp/settings", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := newRhwpHandler().GetRhwpSettings(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["enabled"] != true {
		t.Errorf("enabled = %v, want true", body["enabled"])
	}
	if body["studioUrl"] != "/rhwp/" {
		t.Errorf("studioUrl = %v, want /rhwp/", body["studioUrl"])
	}
}

func TestGetRhwpSettings_EnvOverride(t *testing.T) {
	t.Setenv("RHWP_STUDIO_URL", "https://example.com/rhwp/")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/rhwp/settings", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := newRhwpHandler().GetRhwpSettings(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var body map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body["enabled"] != true {
		t.Errorf("enabled = %v, want true", body["enabled"])
	}
	if body["studioUrl"] != "https://example.com/rhwp/" {
		t.Errorf("studioUrl = %v", body["studioUrl"])
	}
}

func TestGetRhwpSettings_AppendsTrailingSlash(t *testing.T) {
	t.Setenv("RHWP_STUDIO_URL", "https://example.com/rhwp")

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/rhwp/settings", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	_ = newRhwpHandler().GetRhwpSettings(c)

	var body map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if !strings.HasSuffix(body["studioUrl"].(string), "/") {
		t.Errorf("studioUrl missing trailing slash: %v", body["studioUrl"])
	}
}
