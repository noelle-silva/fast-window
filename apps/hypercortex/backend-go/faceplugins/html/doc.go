package html

import "strings"

// emptyDoc 生成网页面的空白文档（与迁移前宿主实现逐字一致）。
func emptyDoc(noteID string, noteTitle string) string {
	return "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n    <meta name=\"hypercortex-note-id\" content=\"" + escapeHTML(strings.TrimSpace(noteID)) + "\" />\n    <meta name=\"hypercortex-note-schema-version\" content=\"2\" />\n    <title>" + escapeHTML(nonEmpty(noteTitle, "未命名")) + "</title>\n  </head>\n  <body>\n    <div id=\"hypercortex-content\"></div>\n  </body>\n</html>"
}

func escapeHTML(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&#34;", "'", "&#39;")
	return replacer.Replace(value)
}

func nonEmpty(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}
