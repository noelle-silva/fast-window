package main

import (
	"strings"
	"testing"
)

func TestParseImageSourceFromHTTPBodyTextShapes(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"data base64", `{"data":[{"b64_json":"` + testPNGBase64 + `"}]}`, "data:image/"},
		{"images data URL", `{"images":[{"data_url":"` + testPNGDataURL + `"}]}`, "data:image/"},
		{"chat JSON content", `{"choices":[{"message":{"content":"{\"image_data_url\":\"` + testPNGDataURL + `\"}"}}]}`, "data:image/"},
		{"fenced base64 JSON", "```json\n{\"b64_json\":\"" + testPNGBase64 + "\"}\n```", "data:image/"},
		{"direct URL field", `{"data":[{"url":"https://external-resources.packyapi.com/images/2026-05-31/ba54ea03-c988-4266-bf99-fc7851ab41a8.png"}]}`, "https://external-resources.packyapi.com/images/2026-05-31/ba54ea03-c988-4266-bf99-fc7851ab41a8.png"},
		{"embedded URL text", `模型已完成：https://external-resources.packyapi.com/images/2026-05-31/ba54ea03-c988-4266-bf99-fc7851ab41a8.png。`, "https://external-resources.packyapi.com/images/2026-05-31/ba54ea03-c988-4266-bf99-fc7851ab41a8.png"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseImageSourceFromHTTPBodyText(tc.body)
			if got == "" {
				t.Fatalf("expected image source for body %s", tc.body)
			}
			if tc.want == "data:image/" {
				if !strings.HasPrefix(got, tc.want) {
					t.Fatalf("expected image data URL, got %q", got)
				}
				return
			}
			if got != tc.want {
				t.Fatalf("expected %q, got %q", tc.want, got)
			}
		})
	}
}

func TestParseImageSourceFromHTTPBodyTextRejectsNonImageURLText(t *testing.T) {
	if got := parseImageSourceFromHTTPBodyText(`查看 https://example.test/page?id=1`); got != "" {
		t.Fatalf("expected no image source, got %q", got)
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
