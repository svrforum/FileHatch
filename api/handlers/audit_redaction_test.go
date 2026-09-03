package handlers

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMarshalRedactedAuditDetailsRecursivelyMasksSecrets(t *testing.T) {
	details := map[string]interface{}{
		"username": "alice",
		"password": "top-secret",
		"nested": map[string]interface{}{
			"oldPassword": "old-secret",
			"items": []interface{}{
				map[string]interface{}{
					"new_password": "new-secret",
					"reason":       "invalid_password",
				},
			},
		},
		"csvRaw":    "username,password\\nalice,secret",
		"rowData":   map[string]interface{}{"email": "alice@example.com"},
		"rowNumber": 7,
	}

	encoded := marshalRedactedAuditDetails(details)
	for _, secret := range []string{"top-secret", "old-secret", "new-secret", "alice@example.com"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("redacted audit details contain secret %q: %s", secret, encoded)
		}
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["username"] != "alice" || decoded["rowNumber"] != float64(7) {
		t.Fatalf("allowlisted metadata was changed: %#v", decoded)
	}
	if decoded["password"] != "[REDACTED]" || decoded["csvRaw"] != "[REDACTED]" {
		t.Fatalf("top-level secrets were not masked: %#v", decoded)
	}
}

func TestMarshalRedactedAuditDetailsFailsClosed(t *testing.T) {
	encoded := marshalRedactedAuditDetails(map[string]interface{}{
		"password": "secret",
		"invalid":  func() {},
	})
	if string(encoded) != "{}" {
		t.Fatalf("marshal failure must produce an empty safe object, got %s", encoded)
	}
}
