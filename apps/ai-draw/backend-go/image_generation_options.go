package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const (
	imageQualityAuto     = "auto"
	imageQualityLow      = "low"
	imageQualityMedium   = "medium"
	imageQualityHigh     = "high"
	imageQualityStandard = "standard"
	imageQualityHD       = "hd"

	imageOutputFormatPNG  = "png"
	imageOutputFormatJPEG = "jpeg"
	imageOutputFormatWebP = "webp"

	imageBackgroundAuto        = "auto"
	imageBackgroundTransparent = "transparent"
	imageBackgroundOpaque      = "opaque"

	imageModerationAuto = "auto"
	imageModerationLow  = "low"

	imageModelFamilyGPTImage1     = "gpt-image-1"
	imageModelFamilyGPTImage1Mini = "gpt-image-1-mini"
	imageModelFamilyGPTImage2     = "gpt-image-2"
	imageModelFamilyDalle2        = "dall-e-2"
	imageModelFamilyDalle3        = "dall-e-3"
	imageModelFamilyUnknown       = "unknown"
)

type imageGenerationOptions struct {
	Size              string `json:"size"`
	Quality           string `json:"quality"`
	OutputFormat      string `json:"outputFormat"`
	OutputCompression *int   `json:"outputCompression"`
	Background        string `json:"background"`
	Moderation        string `json:"moderation"`
	Style             string `json:"style"`
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
	if oneOf(raw.Quality, imageQualityAuto, imageQualityLow, imageQualityMedium, imageQualityHigh, imageQualityStandard, imageQualityHD) {
		out.Quality = strings.TrimSpace(raw.Quality)
	}
	if oneOf(raw.OutputFormat, imageOutputFormatPNG, imageOutputFormatJPEG, imageOutputFormatWebP) {
		out.OutputFormat = strings.TrimSpace(raw.OutputFormat)
	}
	if oneOf(raw.Background, imageBackgroundAuto, imageBackgroundTransparent, imageBackgroundOpaque) {
		out.Background = strings.TrimSpace(raw.Background)
	}
	if oneOf(raw.Moderation, imageModerationAuto, imageModerationLow) {
		out.Moderation = strings.TrimSpace(raw.Moderation)
	}
	if oneOf(raw.Style, "vivid", "natural") {
		out.Style = strings.TrimSpace(raw.Style)
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

func validateImageGenerationOptions(options imageGenerationOptions, model string, protocol string, requestKind string) []string {
	if strings.TrimSpace(protocol) == protocolKindChat || strings.TrimSpace(protocol) == "chat" {
		return nil
	}
	family := detectImageModelFamily(model)
	errors := []string{}
	if !isSupportedImageSize(options.Size, family) {
		errors = append(errors, fmt.Sprintf("当前模型不支持尺寸 %s", options.Size))
	}
	if !isSupportedImageQuality(options.Quality, family, requestKind) {
		errors = append(errors, fmt.Sprintf("当前模型不支持画质 %s", options.Quality))
	}
	if !isGptImageFamily(family) {
		if options.OutputFormat != imageOutputFormatPNG {
			errors = append(errors, "DALL·E 模型不支持 output_format")
		}
		if options.OutputCompression != nil {
			errors = append(errors, "DALL·E 模型不支持 output_compression")
		}
		if options.Background != imageBackgroundAuto {
			errors = append(errors, "DALL·E 模型不支持 background")
		}
		if options.Moderation != imageModerationAuto {
			errors = append(errors, "DALL·E 模型不支持 moderation")
		}
		if options.InputFidelity != "" {
			errors = append(errors, "DALL·E 模型不支持 input_fidelity")
		}
	}
	if family != imageModelFamilyDalle3 && options.Style != "" {
		errors = append(errors, "style 仅支持 DALL·E 3")
	}
	if requestKind == protocolKindImagesEdits && family == imageModelFamilyDalle3 {
		errors = append(errors, "DALL·E 3 不支持 /images/edits 参考图编辑")
	}
	if requestKind == protocolKindImagesEdits && options.Moderation != imageModerationAuto {
		errors = append(errors, "moderation 仅在普通生成时可用")
	}
	if requestKind == protocolKindImages && options.InputFidelity != "" {
		errors = append(errors, "input_fidelity 仅在参考图编辑时可用")
	}
	if requestKind == protocolKindImagesEdits && options.InputFidelity != "" && family == imageModelFamilyGPTImage1Mini {
		errors = append(errors, "gpt-image-1-mini 不支持 input_fidelity")
	}
	if family == imageModelFamilyGPTImage2 && options.Background == imageBackgroundTransparent {
		errors = append(errors, "gpt-image-2 不支持透明背景")
	}
	if options.Background == imageBackgroundTransparent && options.OutputFormat == imageOutputFormatJPEG {
		errors = append(errors, "透明背景需要 png 或 webp 输出格式")
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
	if isGptImageFamily(family) {
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
	} else if family == imageModelFamilyDalle3 && options.Quality != imageQualityAuto {
		fields["quality"] = options.Quality
	}
	if family == imageModelFamilyDalle3 && options.Style != "" {
		fields["style"] = options.Style
	}
	return fields, nil
}

func shouldSendLegacyResponseFormat(model string) bool {
	family := detectImageModelFamily(model)
	return family == imageModelFamilyDalle2 || family == imageModelFamilyDalle3
}

func detectImageModelFamily(model string) string {
	name := strings.ToLower(strings.TrimSpace(model))
	if name == "" {
		return imageModelFamilyUnknown
	}
	if name == imageModelFamilyDalle2 || name == imageModelFamilyDalle3 || name == imageModelFamilyGPTImage1Mini {
		return name
	}
	if name == imageModelFamilyGPTImage2 || strings.HasPrefix(name, "gpt-image-2-") {
		return imageModelFamilyGPTImage2
	}
	if name == imageModelFamilyGPTImage1 || name == "gpt-image-1.5" || strings.HasPrefix(name, "gpt-image-1-") || name == "chatgpt-image-latest" {
		return imageModelFamilyGPTImage1
	}
	return imageModelFamilyUnknown
}

func isGptImageFamily(family string) bool {
	return family == imageModelFamilyGPTImage1 || family == imageModelFamilyGPTImage1Mini || family == imageModelFamilyGPTImage2 || family == imageModelFamilyUnknown
}

func isSupportedImageQuality(quality string, family string, requestKind string) bool {
	if isGptImageFamily(family) {
		return oneOf(quality, imageQualityAuto, imageQualityLow, imageQualityMedium, imageQualityHigh)
	}
	if family == imageModelFamilyDalle3 {
		return requestKind == protocolKindImages && oneOf(quality, imageQualityAuto, imageQualityStandard, imageQualityHD)
	}
	if family == imageModelFamilyDalle2 {
		return oneOf(quality, imageQualityAuto, imageQualityStandard)
	}
	return false
}

func isSupportedImageSize(size string, family string) bool {
	switch family {
	case imageModelFamilyGPTImage2:
		return isGPTImage2Size(size)
	case imageModelFamilyDalle2:
		return oneOf(size, "256x256", "512x512", "1024x1024")
	case imageModelFamilyDalle3:
		return oneOf(size, "1024x1024", "1792x1024", "1024x1792")
	default:
		return oneOf(size, "auto", "1024x1024", "1024x1536", "1536x1024")
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
