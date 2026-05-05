package main

import "testing"

func TestParseImageDataURLFromHTTPBodyTextShapes(t *testing.T) {
	cases := []string{
		`{"data":[{"b64_json":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="}]}`,
		`{"images":[{"data_url":"` + testPNGDataURL + `"}]}`,
		`{"choices":[{"message":{"content":"{\"image_data_url\":\"` + testPNGDataURL + `\"}"}}]}`,
		"```json\n{\"b64_json\":\"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=\"}\n```",
	}
	for _, body := range cases {
		if got := parseImageDataURLFromHTTPBodyText(body); got == "" {
			t.Fatalf("expected image data URL for body %s", body)
		}
	}
}

func TestParseErrorBody(t *testing.T) {
	if got := parseErrorBody(`{"error":{"message":"bad key"}}`); got != "bad key" {
		t.Fatalf("expected nested error message, got %q", got)
	}
	if got := parseErrorBody(`{"message":"bad request"}`); got != "bad request" {
		t.Fatalf("expected direct message, got %q", got)
	}
}
