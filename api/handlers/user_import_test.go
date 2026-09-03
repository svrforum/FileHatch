package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestParseUserImportCSV(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		csv         string
		wantRows    int
		wantErrPart string
	}{
		{
			name:     "accepts BOM and reordered optional headers",
			csv:      "\ufeffpassword,username,is_admin\r\nStrong1!,alice,false\r\n",
			wantRows: 1,
		},
		{
			name:        "rejects unknown header",
			csv:         "username,password,display_name\nalice,Strong1!,Alice\n",
			wantErrPart: "unknown CSV header",
		},
		{
			name:        "rejects duplicate header",
			csv:         "username,password,username\nalice,Strong1!,other\n",
			wantErrPart: "duplicate CSV header",
		},
		{
			name:        "rejects missing required header",
			csv:         "username,email\nalice,a@example.com\n",
			wantErrPart: "required CSV header \"password\" is missing",
		},
		{
			name:        "rejects loose boolean values",
			csv:         "username,password,is_admin\nalice,Strong1!,TRUE\n",
			wantErrPart: "invalid is_admin",
		},
		{
			name:        "rejects fractional quota",
			csv:         "username,password,storage_quota_gb\nalice,Strong1!,1.5\n",
			wantErrPart: "invalid storage_quota_gb",
		},
		{
			name:        "rejects quota over operational limit",
			csv:         "username,password,storage_quota_gb\nalice,Strong1!,1048577\n",
			wantErrPart: "invalid storage_quota_gb",
		},
		{
			name:        "rejects inconsistent field count",
			csv:         "username,password,email\nalice,Strong1!\n",
			wantErrPart: "has 2 fields; expected 3",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			rows, err := parseUserImportCSV([]byte(test.csv))
			if test.wantErrPart != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErrPart) {
					t.Fatalf("parseUserImportCSV() error = %v, want containing %q", err, test.wantErrPart)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseUserImportCSV() unexpected error: %v", err)
			}
			if len(rows) != test.wantRows {
				t.Fatalf("parseUserImportCSV() rows = %d, want %d", len(rows), test.wantRows)
			}
			zeroImportRows(rows)
		})
	}
}

func TestParseUserImportCSV_RowLimit(t *testing.T) {
	t.Parallel()

	var input strings.Builder
	input.WriteString("username,password\n")
	for row := 0; row <= userImportMaxRows; row++ {
		fmt.Fprintf(&input, "user%d,Strong1!\n", row)
	}

	rows, err := parseUserImportCSV([]byte(input.String()))
	zeroImportRows(rows)
	if err == nil || !strings.Contains(err.Error(), "at most 1000 data rows") {
		t.Fatalf("parseUserImportCSV() error = %v, want row limit error", err)
	}
}

func TestUserImportHandler_validateCSV(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New(): %v", err)
	}
	defer db.Close()

	mock.ExpectQuery("SELECT value FROM system_settings").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow("10737418240"))
	mock.ExpectQuery("SELECT EXISTS").WithArgs("alice").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler := &UserImportHandler{
		db: db,
		validatePassword: func(_ context.Context, password string) error {
			if password != "Strong1!" {
				return fmt.Errorf("password rejected")
			}
			return nil
		},
		policyRevision: func(context.Context) (string, error) {
			return "revision-7", nil
		},
		now: func() time.Time {
			return time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)
		},
	}

	validation, err := handler.validateCSV(
		context.Background(),
		[]byte("username,email,password,is_admin,storage_quota_gb\n"+
			"alice,a@example.com,Strong1!,false,\n"+
			"alice,b@example.com,not-secret,false,0\n"),
	)
	if err != nil {
		t.Fatalf("validateCSV() unexpected error: %v", err)
	}
	if validation.Valid || validation.ValidRows != 1 || validation.InvalidRows != 1 {
		t.Fatalf("validateCSV() counts = valid:%d invalid:%d overall:%v", validation.ValidRows, validation.InvalidRows, validation.Valid)
	}
	if len(validation.Rows) != 1 || validation.Rows[0].StorageByte != 10737418240 {
		t.Fatalf("validateCSV() valid rows/default quota were not retained correctly")
	}
	if validation.Results[1].Code != "duplicate_in_file" {
		t.Fatalf("validateCSV() duplicate code = %q, want duplicate_in_file", validation.Results[1].Code)
	}

	encoded, err := json.Marshal(validation)
	if err != nil {
		t.Fatalf("json.Marshal(): %v", err)
	}
	if strings.Contains(string(encoded), "Strong1!") || strings.Contains(string(encoded), "not-secret") {
		t.Fatal("validation JSON exposed a plaintext password")
	}
	zeroImportRows(validation.Rows)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestEscapeSpreadsheetCell(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "formula equals", input: "=SUM(1,1)", want: "'=SUM(1,1)"},
		{name: "formula plus", input: "+cmd", want: "'+cmd"},
		{name: "formula minus", input: "-1", want: "'-1"},
		{name: "formula at", input: "@cmd", want: "'@cmd"},
		{name: "leading tab", input: "\t=cmd", want: "'\t=cmd"},
		{name: "leading CR", input: "\r=cmd", want: "'\r=cmd"},
		{name: "leading LF", input: "\n=cmd", want: "'\n=cmd"},
		{name: "ordinary text", input: "safe", want: "safe"},
		{name: "empty", input: "", want: ""},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := escapeSpreadsheetCell(test.input); got != test.want {
				t.Fatalf("escapeSpreadsheetCell(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}

func TestSafePasswordValidationMessage(t *testing.T) {
	t.Parallel()

	password := "sensitive-password"
	err := fmt.Errorf("rejected value %s", password)
	message := safePasswordValidationMessage(err, password)
	if strings.Contains(message, password) {
		t.Fatal("safePasswordValidationMessage() exposed the plaintext password")
	}
}

func TestZeroImportRows(t *testing.T) {
	t.Parallel()

	rows := []userImportRow{
		{Password: "first-secret"},
		{Password: "second-secret"},
	}
	zeroImportRows(rows)
	for index, row := range rows {
		if row.Password != "" {
			t.Fatalf("row %d password was not cleared", index)
		}
	}
}
