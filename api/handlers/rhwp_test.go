package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
)

func TestGetRhwpSettings_DefaultStudioUrl(t *testing.T) {
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
	assert.Equal(t, true, body["enabled"])
	assert.Equal(t, "https://edwardkim.github.io/rhwp/", body["studioUrl"])
}

func TestGetRhwpSettings_OverrideViaEnv(t *testing.T) {
	t.Setenv("RHWP_STUDIO_URL", "https://hwp.example.com/")

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
	assert.Equal(t, "https://hwp.example.com/", body["studioUrl"])
}

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
	assert.Equal(t, "https://hwp.example.com/", body["studioUrl"])
}
