package main

import "strings"

var registryButtonDefaultIconIDs = []string{
	"sparkles",
	"message-square",
	"book-open",
	"pencil-line",
	"languages",
	"search",
	"brain-circuit",
	"code-2",
	"file-text",
	"zap",
	"star",
	"wand-sparkles",
	"clipboard-list",
	"globe",
	"mail",
	"chart-bar",
	"shield-check",
	"link-2",
}

func resolveRegistryButtonIcon(value string, seed string) string {
	icon := strings.TrimSpace(value)
	if icon != "" {
		return icon
	}
	return seededRegistryButtonIcon(seed)
}

func seededRegistryButtonIcon(seed string) string {
	text := strings.TrimSpace(seed)
	if text == "" {
		return registryButtonDefaultIconIDs[0]
	}
	var hash uint32
	for _, char := range text {
		hash = hash*31 + uint32(char)
	}
	return registryButtonDefaultIconIDs[int(hash)%len(registryButtonDefaultIconIDs)]
}
