package handlers

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// The OnlyOffice save callback hands us a URL and we fetch it. The callback is
// a public endpoint, so that URL is attacker-controlled until proven otherwise:
// fetching it verbatim turns the API container into an SSRF proxy with access
// to the internal Docker network and any cloud metadata endpoint, and the
// response body is then written to disk.
//
// Every fetch therefore goes through onlyOfficeFetch, which will only talk to
// the configured OnlyOffice host.

// maxOnlyOfficeDocumentBytes caps a single saved document. OnlyOffice documents
// are not this large; the cap exists so a hostile URL cannot stream until the
// disk fills.
const maxOnlyOfficeDocumentBytes = 512 << 20 // 512 MiB

// onlyOfficeAllowedHosts returns the host[:port] values we are willing to fetch
// a document from, in the order they should be tried.
func onlyOfficeAllowedHosts() []string {
	hosts := []string{}
	for _, raw := range []string{getOnlyOfficeInternalURL(), getOnlyOfficePublicURL()} {
		if raw == "" {
			continue
		}
		if u, err := url.Parse(raw); err == nil && u.Host != "" {
			hosts = append(hosts, u.Host)
		}
	}
	return hosts
}

// resolveOnlyOfficeDownloadURL validates that rawURL points at the configured
// OnlyOffice service and rewrites it to the internal address.
//
// The previous helper returned the URL unchanged whenever it did not match a
// known prefix, which meant "unrecognised host" was treated as "fetch it
// anyway".
func resolveOnlyOfficeDownloadURL(rawURL string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("malformed document URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("unsupported document URL scheme %q", parsed.Scheme)
	}

	internal, err := url.Parse(getOnlyOfficeInternalURL())
	if err != nil || internal.Host == "" {
		return "", fmt.Errorf("OnlyOffice internal URL is not configured correctly")
	}

	for _, allowed := range onlyOfficeAllowedHosts() {
		if parsed.Host != allowed {
			continue
		}
		// Rewrite to the internal address, keeping path and query intact.
		rewritten := *parsed
		rewritten.Scheme = internal.Scheme
		rewritten.Host = internal.Host
		return rewritten.String(), nil
	}

	return "", fmt.Errorf("document URL host %q is not the configured OnlyOffice service", parsed.Host)
}

// onlyOfficeHTTPClient refuses redirects: a permitted host must not be able to
// bounce the fetch onto an arbitrary one.
var onlyOfficeHTTPClient = &http.Client{
	Timeout: 2 * time.Minute,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return fmt.Errorf("redirects are not followed when fetching OnlyOffice documents")
	},
}

// onlyOfficeFetch validates the URL, downloads the document and returns its
// bytes.
func onlyOfficeFetch(rawURL string) ([]byte, error) {
	downloadURL, err := resolveOnlyOfficeDownloadURL(rawURL)
	if err != nil {
		return nil, err
	}

	resp, err := onlyOfficeHTTPClient.Get(downloadURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("document download returned status %d", resp.StatusCode)
	}

	content, err := io.ReadAll(io.LimitReader(resp.Body, maxOnlyOfficeDocumentBytes+1))
	if err != nil {
		return nil, err
	}
	if len(content) > maxOnlyOfficeDocumentBytes {
		return nil, fmt.Errorf("document exceeds the %d byte limit", maxOnlyOfficeDocumentBytes)
	}

	return content, nil
}
