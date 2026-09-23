package markdown

import (
	"regexp"
	"strings"
)

/* ------------------------------------------------------------------ */
/*  面自供搜索文本（markdown）：保留代码区域原文，将正文中的内嵌占位符      */
/*  换成渲染时可见的文本，让搜索命中与摘要贴近用户实际看到的内容。           */
/* ------------------------------------------------------------------ */

var searchNoteRefPattern = regexp.MustCompile(`\[\[([^\]\n]+?)\]\]`)
var searchAssetPattern = regexp.MustCompile(`\{\{asset:[^\}\n]+?\}\}`)

// searchTextSegment 表示一段文本：code=true 表示代码区域（围栏代码块或行内代码），原样保留。
type searchTextSegment struct {
	code  bool
	value string
}

// SearchText 把 markdown 内容转成可搜文本（文本面的搜索语义）。
func SearchText(content string) string {
	src := strings.ReplaceAll(content, "\r\n", "\n")
	segments := splitSearchFenceSegments(src)
	var builder strings.Builder
	for _, segment := range segments {
		if segment.code {
			builder.WriteString(segment.value)
			continue
		}
		builder.WriteString(transformSearchPlainText(segment.value))
	}
	return builder.String()
}

// splitSearchFenceSegments 将源码按 ``` 围栏代码块切成段落，语义与前端渲染 tokenizeFences 一致。
func splitSearchFenceSegments(src string) []searchTextSegment {
	lines := strings.Split(src, "\n")
	out := []searchTextSegment{}
	textBuf := []string{}
	flushText := func() {
		if len(textBuf) == 0 {
			return
		}
		out = append(out, searchTextSegment{value: strings.Join(textBuf, "")})
		textBuf = textBuf[:0]
	}
	inFence := false
	fenceIndent := ""
	fenceMarker := ""
	fenceLines := []string{}
	openRe := regexp.MustCompile(`^(\s*)(` + "`" + `{3,})(.*)$`)
	closeRe := regexp.MustCompile(`^(\s*)(` + "`" + `{3,})\s*$`)
	for idx, line := range lines {
		withNl := line
		if idx < len(lines)-1 {
			withNl += "\n"
		}
		if !inFence {
			m := openRe.FindStringSubmatch(line)
			if m == nil {
				textBuf = append(textBuf, withNl)
				continue
			}
			flushText()
			inFence = true
			fenceIndent = m[1]
			fenceMarker = m[2]
			fenceLines = []string{withNl}
			continue
		}
		m := closeRe.FindStringSubmatch(line)
		if m != nil && m[1] == fenceIndent && m[2] == fenceMarker {
			fenceLines = append(fenceLines, withNl)
			out = append(out, searchTextSegment{code: true, value: strings.Join(fenceLines, "")})
			inFence = false
			fenceIndent = ""
			fenceMarker = ""
			fenceLines = nil
			continue
		}
		fenceLines = append(fenceLines, withNl)
	}
	if inFence {
		out = append(out, searchTextSegment{code: true, value: strings.Join(fenceLines, "")})
	} else {
		flushText()
	}
	return out
}

// transformSearchPlainText 处理非代码正文：引用占位符换成渲染可见文本、附件占位符清掉。
// 行内代码区域原样保留（与前端渲染仅在行外替换占位符的语义一致）。
func transformSearchPlainText(segment string) string {
	parts := splitSearchInlineCodeSegments(segment)
	var builder strings.Builder
	for _, part := range parts {
		if part.code {
			builder.WriteString(part.value)
			continue
		}
		value := searchNoteRefPattern.ReplaceAllStringFunc(part.value, func(m string) string {
			return searchNoteRefDisplayText(m)
		})
		value = searchAssetPattern.ReplaceAllString(value, " ")
		builder.WriteString(value)
	}
	return builder.String()
}

func splitSearchInlineCodeSegments(src string) []searchTextSegment {
	out := []searchTextSegment{}
	i := 0
	last := 0
	for i < len(src) {
		if src[i] != '`' {
			i++
			continue
		}
		j := i
		for j < len(src) && src[j] == '`' {
			j++
		}
		marker := src[i:j]
		closeAt := strings.Index(src[j:], marker)
		if closeAt < 0 {
			break
		}
		closeAt += j
		end := closeAt + len(marker)
		if i > last {
			out = append(out, searchTextSegment{value: src[last:i]})
		}
		out = append(out, searchTextSegment{code: true, value: src[i:end]})
		i = end
		last = i
	}
	if last < len(src) {
		out = append(out, searchTextSegment{value: src[last:]})
	}
	return out
}

// searchNoteRefDisplayText 引用占位符在渲染时展示 title（无 title 用 remarks）；
// 两者都没有时该占位符不产生可见文字，移除。
func searchNoteRefDisplayText(placeholder string) string {
	inner := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(placeholder, "[["), "]]"))
	noteID := ""
	title := ""
	remarks := ""
	for _, part := range strings.Split(inner, "|") {
		seg := strings.TrimSpace(part)
		if seg == "" {
			continue
		}
		eq := strings.Index(seg, "=")
		if eq < 0 {
			continue
		}
		key := strings.TrimSpace(seg[:eq])
		value := seg[eq+1:]
		switch key {
		case "note_id":
			noteID = strings.TrimSpace(value)
		case "title":
			title = value
		case "remarks":
			remarks = value
		}
	}
	if noteID == "" {
		return placeholder
	}
	display := strings.TrimSpace(title)
	if display == "" {
		display = strings.TrimSpace(remarks)
	}
	if display == "" {
		return ""
	}
	return display
}
