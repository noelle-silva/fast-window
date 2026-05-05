package main

import (
	"encoding/base64"
	"encoding/json"
	"regexp"
	"strings"
)

var embeddedDataURLPattern = regexp.MustCompile(`(?i)data:image/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=_\-\r\n\t ]+`)
var bareBase64Pattern = regexp.MustCompile(`^[A-Za-z0-9+/=_\-\r\n\t ]+$`)

func parseImageDataURLFromHTTPBodyText(bodyText string) string {
	var value any
	if err := json.Unmarshal([]byte(bodyText), &value); err == nil {
		if dataURL := extractImageFromHTTPJSON(value); dataURL != "" {
			return dataURL
		}
	}
	return extractImageFromText(bodyText)
}

func parseErrorBody(body string) string {
	var value any
	if err := json.Unmarshal([]byte(body), &value); err == nil {
		if object, ok := value.(map[string]any); ok {
			if errorObject, ok := object["error"].(map[string]any); ok {
				if message := strings.TrimSpace(asString(errorObject["message"])); message != "" {
					return message
				}
			}
			if message := strings.TrimSpace(asString(object["message"])); message != "" {
				return message
			}
		}
	}
	return strings.TrimSpace(body)
}

func extractImageFromHTTPJSON(value any) string {
	if object, ok := value.(map[string]any); ok {
		if dataURL := extractImageFromCollection(object["data"]); dataURL != "" {
			return dataURL
		}
		if dataURL := extractImageFromCollection(object["images"]); dataURL != "" {
			return dataURL
		}
		if choices, ok := object["choices"].([]any); ok && len(choices) > 0 {
			if choice, ok := choices[0].(map[string]any); ok {
				if message, ok := choice["message"].(map[string]any); ok {
					if dataURL := extractImageFromValue(message["content"], 0); dataURL != "" {
						return dataURL
					}
				}
			}
		}
	}
	return extractImageFromValue(value, 0)
}

func extractImageFromCollection(value any) string {
	items, ok := value.([]any)
	if !ok || len(items) == 0 {
		return ""
	}
	return extractImageFromValue(items[0], 0)
}

func extractImageFromValue(value any, depth int) string {
	if depth > 8 || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return extractImageFromText(typed)
	case []any:
		for _, item := range typed {
			if dataURL := extractImageFromValue(item, depth+1); dataURL != "" {
				return dataURL
			}
		}
	case map[string]any:
		for _, key := range []string{"data_url", "dataUrl", "image", "image_data_url"} {
			if dataURL := extractImageFromStringField(typed[key]); dataURL != "" {
				return dataURL
			}
		}
		for _, key := range []string{"b64_png", "b64_json", "b64", "base64", "image_base64", "png_base64"} {
			if dataURL := imageDataURLFromBase64String(asString(typed[key])); dataURL != "" {
				return dataURL
			}
		}
		for _, key := range []string{"content", "text", "message"} {
			if dataURL := extractImageFromValue(typed[key], depth+1); dataURL != "" {
				return dataURL
			}
		}
	}
	return ""
}

func extractImageFromStringField(value any) string {
	text := strings.TrimSpace(asString(value))
	if text == "" {
		return ""
	}
	if strings.HasPrefix(text, "data:image/") || bareBase64Pattern.MatchString(text) {
		return normalizeImageDataURLOrBase64(text)
	}
	return ""
}

func extractImageFromText(text string) string {
	value := strings.TrimSpace(text)
	if value == "" {
		return ""
	}
	if match := embeddedDataURLPattern.FindString(value); match != "" {
		return normalizeImageDataURLOrBase64(match)
	}
	maybeJSON := stripCodeFences(value)
	if maybeJSON != value {
		var nested any
		if err := json.Unmarshal([]byte(maybeJSON), &nested); err == nil {
			if dataURL := extractImageFromValue(nested, 0); dataURL != "" {
				return dataURL
			}
		}
	}
	if len(value) > 200 && bareBase64Pattern.MatchString(value) {
		return imageDataURLFromBase64String(value)
	}
	return ""
}

func stripCodeFences(text string) string {
	value := strings.TrimSpace(text)
	if !strings.HasPrefix(value, "```") {
		return value
	}
	start := strings.Index(value, "\n")
	end := strings.LastIndex(value, "```")
	if start >= 0 && end > start {
		return strings.TrimSpace(value[start+1 : end])
	}
	return value
}

func normalizeImageDataURLOrBase64(input string) string {
	value := strings.TrimSpace(input)
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		return value
	}
	if strings.HasPrefix(value, "data:image/") {
		mime, bytes, err := normalizeImageInput(value)
		if err != nil {
			return value
		}
		return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(bytes)
	}
	return imageDataURLFromBase64String(value)
}

func imageDataURLFromBase64String(input string) string {
	mime, bytes, err := normalizeImageInput(input)
	if err != nil {
		return ""
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(bytes)
}
