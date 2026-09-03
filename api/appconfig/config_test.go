package appconfig

import (
	"reflect"
	"testing"
)

func TestPathsAndInternalURLs(t *testing.T) {
	t.Setenv("DATA_ROOT", "/srv/filehatch")
	t.Setenv("CONFIG_PATH", "/srv/filehatch-config")
	t.Setenv("API_INTERNAL_URL", "http://backend:9000/")
	t.Setenv("ONLYOFFICE_INTERNAL_URL", "http://documents:8080/")

	if got := DataRoot(); got != "/srv/filehatch" {
		t.Fatalf("DataRoot() = %q", got)
	}
	if got := ConfigPath(); got != "/srv/filehatch-config" {
		t.Fatalf("ConfigPath() = %q", got)
	}
	if got := APIInternalURL(); got != "http://backend:9000" {
		t.Fatalf("APIInternalURL() = %q", got)
	}
	if got := OnlyOfficeInternalURL(); got != "http://documents:8080" {
		t.Fatalf("OnlyOfficeInternalURL() = %q", got)
	}
}

func TestAllowedOrigins(t *testing.T) {
	tests := []struct {
		name        string
		environment string
		cors        string
		legacy      string
		want        []string
	}{
		{
			name:        "production defaults to same origin",
			environment: "production",
			want:        []string{},
		},
		{
			name: "configured origins are trimmed",
			cors: " https://files.example.com/, http://localhost:3080 ",
			want: []string{"https://files.example.com", "http://localhost:3080"},
		},
		{
			name:   "legacy websocket variable remains an alias",
			legacy: "https://legacy.example.com",
			want:   []string{"https://legacy.example.com"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("FH_ENV", test.environment)
			t.Setenv("CORS_ALLOWED_ORIGINS", test.cors)
			t.Setenv("ALLOWED_ORIGINS", test.legacy)
			if got := AllowedOrigins(); !reflect.DeepEqual(got, test.want) {
				t.Fatalf("AllowedOrigins() = %#v, want %#v", got, test.want)
			}
		})
	}
}
