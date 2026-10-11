package mindmap

import "strings"

// SearchText 遍历导图节点文本，拼成可搜文本。
func SearchText(content string) string {
	root, ok := parseDocument(content)
	if !ok {
		return ""
	}
	parts := []string{}
	walkTexts(root, func(text string) {
		if trimmed := strings.TrimSpace(text); trimmed != "" {
			parts = append(parts, trimmed)
		}
	})
	return strings.Join(parts, "\n")
}
