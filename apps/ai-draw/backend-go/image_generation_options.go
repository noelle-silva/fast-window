package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const (
	imageQualityAuto   = "auto"
	imageQualityLow    = "low"
	imageQualityMedium = "medium"
	imageQualityHigh   = "high"

	imageOutputFormatPNG  = "png"
	imageOutputFormatJPEG = "jpeg"
	imageOutputFormatWebP = "webp"

	imageBackgroundAuto   = "auto"
	imageBackgroundOpaque = "opaque"

	imageModerationAuto = "auto"
	imageModerationLow  = "low"

	imageModelFamilyGPTImage2   = "gpt-image-2"
	imageModelFamilyUnsupported = "unsupported"
)

type imageGenerationOptions struct {
	Size              string `json:"size"`
	Quality           string `json:"quality"`
	OutputFormat      string `json:"outputFormat"`
	OutputCompression *int   `json:"outputCompression"`
	Background        string `json:"background"`
	Moderation        string `json:"moderation"`
	InputFidelity     string `json:"inputFidelity"`
}

var customSizePattern = regexp.MustCompile(`^(\d{2,5})x(\d{2,5})$`)

func defaultImageGenerationOptions() imageGenerationOptions {
	return imageGenerationOptions{
		Size:         "1024x1024",
		Quality:      imageQualityAuto,
		OutputFormat: imageOutputFormatPNG,
		Background:   imageBackgroundAuto,
		Moderation:   imageModerationAuto,
	}
}

func normalizeImageGenerationOptions(raw imageGenerationOptions) imageGenerationOptions {
	out := defaultImageGenerationOptions()
	if size := strings.TrimSpace(raw.Size); isImageSizeSyntax(size) {
		out.Size = size
	}
	if oneOf(raw.Quality, imageQualityAuto, imageQualityLow, imageQualityMedium, imageQualityHigh) {
		out.Quality = strings.TrimSpace(raw.Quality)
	}
	if oneOf(raw.OutputFormat, imageOutputFormatPNG, imageOutputFormatJPEG, imageOutputFormatWebP) {
		out.OutputFormat = strings.TrimSpace(raw.OutputFormat)
	}
	if oneOf(raw.Background, imageBackgroundAuto, imageBackgroundOpaque) {
		out.Background = strings.TrimSpace(raw.Background)
	}
	if oneOf(raw.Moderation, imageModerationAuto, imageModerationLow) {
		out.Moderation = strings.TrimSpace(raw.Moderation)
	}
	if oneOf(raw.InputFidelity, imageQualityLow, imageQualityHigh) {
		out.InputFidelity = strings.TrimSpace(raw.InputFidelity)
	}
	if raw.OutputCompression != nil && out.OutputFormat != imageOutputFormatPNG {
		value := *raw.OutputCompression
		if value < 0 {
			value = 0
		}
		if value > 100 {
			value = 100
		}
		out.OutputCompression = &value
	}
	return out
}

func validateRawImageGenerationOptions(raw map[string]any, model string, protocol string, requestKind string) []string {
	if strings.TrimSpace(protocol) == protocolKindChat || strings.TrimSpace(protocol) == "chat" {
		return nil
	}
	if raw == nil {
		raw = map[string]any{}
	}
	errors := validateRawImageOptionChoices(raw)
	if len(errors) == 0 {
		errors = append(errors, validateImageGenerationOptions(rawImageOptionsToStruct(raw), model, protocol, requestKind)...)
	}
	return errors
}

func validateRawImageOptionChoices(raw map[string]any) []string {
	errors := []string{}
	validateRawStringChoice(&errors, raw["size"], "size", isImageSizeSyntax, "尺寸格式必须是 auto 或 宽x高")
	validateRawStringChoice(&errors, raw["quality"], "quality", func(value string) bool {
		return oneOf(value, imageQualityAuto, imageQualityLow, imageQualityMedium, imageQualityHigh)
	}, "画质仅支持 auto/low/medium/high")
	validateRawStringChoice(&errors, coalesceRaw(raw, "outputFormat", "output_format"), "output_format", func(value string) bool {
		return oneOf(value, imageOutputFormatPNG, imageOutputFormatJPEG, imageOutputFormatWebP)
	}, "输出格式仅支持 png/jpeg/webp")
	validateRawStringChoice(&errors, raw["background"], "background", func(value string) bool {
		return oneOf(value, imageBackgroundAuto, imageBackgroundOpaque)
	}, "背景仅支持 auto/opaque")
	validateRawStringChoice(&errors, raw["moderation"], "moderation", func(value string) bool {
		return oneOf(value, imageModerationAuto, imageModerationLow)
	}, "审核仅支持 auto/low")
	validateRawStringChoice(&errors, coalesceRaw(raw, "inputFidelity", "input_fidelity"), "input_fidelity", func(value string) bool {
		return oneOf(value, imageQualityLow, imageQualityHigh)
	}, "参考保真仅支持 low/high")
	if hasRawText(raw["style"]) {
		errors = append(errors, "style 已移除，gpt-image-2 不支持旧版风格字段")
	}
	if rawCompression := coalesceRaw(raw, "outputCompression", "output_compression"); rawCompression != nil && strings.TrimSpace(fmt.Sprint(rawCompression)) != "" {
		value, err := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(rawCompression)), 64)
		if err != nil || value < 0 || value > 100 {
			errors = append(errors, "output_compression 必须是 0 到 100 的数字")
		}
		rawFormat := rawString(coalesceRaw(raw, "outputFormat", "output_format"))
		if rawFormat == "" {
			rawFormat = imageOutputFormatPNG
		}
		if rawFormat == imageOutputFormatPNG {
			errors = append(errors, "output_compression 仅对 jpeg/webp 生效")
		}
	}
	return errors
}

func rawImageOptionsToStruct(raw map[string]any) imageGenerationOptions {
	out := imageGenerationOptions{}
	out.Size = rawString(raw["size"])
	out.Quality = rawString(raw["quality"])
	out.OutputFormat = rawString(coalesceRaw(raw, "outputFormat", "output_format"))
	out.Background = rawString(raw["background"])
	out.Moderation = rawString(raw["moderation"])
	out.InputFidelity = rawString(coalesceRaw(raw, "inputFidelity", "input_fidelity"))
	if rawCompression := coalesceRaw(raw, "outputCompression", "output_compression"); rawCompression != nil && strings.TrimSpace(fmt.Sprint(rawCompression)) != "" {
		value, err := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(rawCompression)), 64)
		if err == nil {
			intValue := int(value)
			out.OutputCompression = &intValue
		}
	}
	return normalizeImageGenerationOptions(out)
}

func validateRawStringChoice(errors *[]string, raw any, field string, isValid func(string) bool, message string) {
	if !hasRawText(raw) {
		return
	}
	value := strings.TrimSpace(fmt.Sprint(raw))
	if !isValid(value) {
		*errors = append(*errors, fmt.Sprintf("%s: %s", field, message))
	}
}

func coalesceRaw(raw map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			return value
		}
	}
	return nil
}

func rawString(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func hasRawText(value any) bool {
	return value != nil && strings.TrimSpace(fmt.Sprint(value)) != ""
}

func validateImageGenerationOptions(options imageGenerationOptions, model string, protocol string, requestKind string) []string {
	if strings.TrimSpace(protocol) == protocolKindChat || strings.TrimSpace(protocol) == "chat" {
		return nil
	}
	family := detectImageModelFamily(model)
	errors := []string{}
	if family != imageModelFamilyGPTImage2 {
		return []string{"当前 Image API 参数仅支持 gpt-image-2"}
	}
	if !isSupportedImageSize(options.Size, family) {
		errors = append(errors, fmt.Sprintf("当前模型不支持尺寸 %s", options.Size))
	}
	if !isSupportedImageQuality(options.Quality, family, requestKind) {
		errors = append(errors, fmt.Sprintf("当前模型不支持画质 %s", options.Quality))
	}
	if requestKind == protocolKindImagesEdits && options.Moderation != imageModerationAuto {
		errors = append(errors, "moderation 仅在普通生成时可用")
	}
	if requestKind == protocolKindImages && options.InputFidelity != "" {
		errors = append(errors, "input_fidelity 仅在参考图编辑时可用")
	}
	if options.OutputCompression != nil && options.OutputFormat == imageOutputFormatPNG {
		errors = append(errors, "output_compression 仅对 jpeg/webp 生效")
	}
	return errors
}

func buildOpenAIImageOptionFields(options imageGenerationOptions, model string, protocol string, requestKind string) (map[string]any, error) {
	options = normalizeImageGenerationOptions(options)
	if errors := validateImageGenerationOptions(options, model, protocol, requestKind); len(errors) > 0 {
		return nil, providerError{Message: strings.Join(errors, "\n")}
	}
	if strings.TrimSpace(protocol) == "chat" {
		return map[string]any{}, nil
	}
	family := detectImageModelFamily(model)
	fields := map[string]any{"size": options.Size}
	if family == imageModelFamilyGPTImage2 {
		fields["quality"] = options.Quality
		fields["output_format"] = options.OutputFormat
		fields["background"] = options.Background
		if requestKind == protocolKindImages {
			fields["moderation"] = options.Moderation
		}
		if options.OutputCompression != nil {
			fields["output_compression"] = *options.OutputCompression
		}
		if requestKind == protocolKindImagesEdits && options.InputFidelity != "" {
			fields["input_fidelity"] = options.InputFidelity
		}
	}
	return fields, nil
}

func detectImageModelFamily(model string) string {
	name := strings.ToLower(strings.TrimSpace(model))
	if name == "" {
		return imageModelFamilyUnsupported
	}
	if name == imageModelFamilyGPTImage2 || strings.HasPrefix(name, "gpt-image-2-") {
		return imageModelFamilyGPTImage2
	}
	return imageModelFamilyUnsupported
}

func isSupportedImageQuality(quality string, family string, requestKind string) bool {
	_ = requestKind
	if family == imageModelFamilyGPTImage2 {
		return oneOf(quality, imageQualityAuto, imageQualityLow, imageQualityMedium, imageQualityHigh)
	}
	return false
}

func isSupportedImageSize(size string, family string) bool {
	switch family {
	case imageModelFamilyGPTImage2:
		return isGPTImage2Size(size)
	default:
		return false
	}
}

func isGPTImage2Size(size string) bool {
	if oneOf(size, "auto", "1024x1024", "1024x1536", "1536x1024") {
		return true
	}
	match := customSizePattern.FindStringSubmatch(size)
	if len(match) != 3 {
		return false
	}
	width, errW := strconv.Atoi(match[1])
	height, errH := strconv.Atoi(match[2])
	if errW != nil || errH != nil || width%16 != 0 || height%16 != 0 || width > 3840 || height > 2160 {
		return false
	}
	ratio := float64(width) / float64(height)
	return ratio >= 1.0/3.0 && ratio <= 3.0
}

func isImageSizeSyntax(size string) bool {
	return size == "auto" || customSizePattern.MatchString(size)
}

func oneOf(value string, allowed ...string) bool {
	text := strings.TrimSpace(value)
	for _, item := range allowed {
		if text == item {
			return true
		}
	}
	return false
}
