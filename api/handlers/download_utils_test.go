package handlers

import (
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
)

func TestSetContentDisposition(t *testing.T) {
	tests := []struct {
		name             string
		filename         string
		expectedFilename string // ASCII fallback
		expectedEncoded  string // RFC 5987 encoded
	}{
		{
			name:             "ASCII filename",
			filename:         "test.txt",
			expectedFilename: "test.txt",
			expectedEncoded:  "test.txt",
		},
		{
			name:             "Korean filename",
			filename:         "한글파일.txt",
			expectedFilename: "____.txt", // Non-ASCII replaced with underscores (4 chars)
			expectedEncoded:  "%ED%95%9C%EA%B8%80%ED%8C%8C%EC%9D%BC.txt",
		},
		{
			name:             "Mixed Korean and English",
			filename:         "테스트_test_파일.pdf",
			expectedFilename: "____test___.pdf", // 테스트=4chars, 파일=2chars
			expectedEncoded:  "%ED%85%8C%EC%8A%A4%ED%8A%B8_test_%ED%8C%8C%EC%9D%BC.pdf",
		},
		{
			name:             "Japanese filename",
			filename:         "ファイル.doc",
			expectedFilename: "____.doc",
			expectedEncoded:  "%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB.doc",
		},
		{
			name:             "Chinese filename",
			filename:         "文件.xlsx",
			expectedFilename: "__.xlsx",
			expectedEncoded:  "%E6%96%87%E4%BB%B6.xlsx",
		},
		{
			name:             "Filename with spaces",
			filename:         "my file name.txt",
			expectedFilename: "my file name.txt",
			expectedEncoded:  "my%20file%20name.txt",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := echo.New()
			req := httptest.NewRequest("GET", "/", nil)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)

			setContentDisposition(c, tt.filename)

			header := rec.Header().Get("Content-Disposition")
			assert.NotEmpty(t, header)

			// Check that header contains both filename formats
			assert.Contains(t, header, `attachment;`)
			assert.Contains(t, header, `filename="`)
			assert.Contains(t, header, `filename*=UTF-8''`)

			// Check ASCII fallback filename
			assert.Contains(t, header, `filename="`+tt.expectedFilename+`"`)

			// Check RFC 5987 encoded filename
			assert.Contains(t, header, `filename*=UTF-8''`+tt.expectedEncoded)
		})
	}
}

func TestSanitizeToASCII(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "ASCII only",
			input:    "test.txt",
			expected: "test.txt",
		},
		{
			name:     "Korean characters",
			input:    "한글.txt",
			expected: "__.txt",
		},
		{
			name:     "Mixed characters",
			input:    "file_파일.pdf",
			expected: "file___.pdf",
		},
		{
			name:     "Double quotes",
			input:    `file"name.txt`,
			expected: "file_name.txt",
		},
		{
			name:     "Korean only filename",
			input:    "한글",
			expected: "__", // Each Korean char becomes underscore
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sanitizeToASCII(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}
