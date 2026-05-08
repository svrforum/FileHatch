package handlers

import _ "embed"

// blankHwpTemplate is a minimal valid empty HWP 5.0 document used as the
// template for "새 파일 → 한글 문서". Sourced from rhwp upstream's
// `template/blank-batang.hwp` (MIT-licensed). 8.5 KB OLE/CFB binary.
//
// Replacement: re-fetch with
//
//	curl -fsSL -o api/handlers/templates/blank.hwp \
//	  https://raw.githubusercontent.com/edwardkim/rhwp/main/template/blank-batang.hwp
//
//go:embed templates/blank.hwp
var blankHwpTemplate []byte

// createHwpTemplate returns a copy of the embedded blank HWP template.
// We return a copy (not the slice itself) to ensure callers can safely
// modify the bytes without affecting the embedded asset.
func createHwpTemplate() []byte {
	out := make([]byte, len(blankHwpTemplate))
	copy(out, blankHwpTemplate)
	return out
}
