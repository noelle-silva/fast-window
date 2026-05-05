package main

import (
	"fmt"
	"math"
	"net/url"
	"strings"
)

const (
	defaultRequestTimeoutSec = 120
	minRequestTimeoutSec     = 5
	maxRequestTimeoutSec     = 3600
)

func resolveProviderModel(provider generationProvider) string {
	model := strings.TrimSpace(provider.Model)
	if model == "__custom__" {
		return strings.TrimSpace(provider.CustomModel)
	}
	return model
}

func trimSlash(value string) string {
	text := strings.TrimSpace(value)
	for strings.HasSuffix(text, "/") {
		text = strings.TrimSuffix(text, "/")
	}
	return text
}

func isHTTPBaseURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	return (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
}

func normalizeRequestTimeoutSec(value int) int {
	if value <= 0 {
		value = defaultRequestTimeoutSec
	}
	if value < minRequestTimeoutSec {
		return minRequestTimeoutSec
	}
	if value > maxRequestTimeoutSec {
		return maxRequestTimeoutSec
	}
	return value
}

func formatBytes(value int64) string {
	if value <= 0 {
		return "0B"
	}
	if value < 1024 {
		return fmt.Sprintf("%dB", value)
	}
	if value < 1024*1024 {
		return fmt.Sprintf("%.0fKB", math.Round(float64(value)/1024))
	}
	return fmt.Sprintf("%.2fMB", float64(value)/1024/1024)
}
