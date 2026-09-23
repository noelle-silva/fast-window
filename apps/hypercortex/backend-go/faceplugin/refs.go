package faceplugin

import (
	"regexp"
	"strings"
)

var fenceLineHeadRe = regexp.MustCompile(`^[ \t]{0,3}` + "```")
var fenceLineSeekRe = regexp.MustCompile(`\n[ \t]{0,3}` + "```")

// maskFencedCodeBlocks 与前端 noteRefs.ts 保持一致：遮蔽 ``` 围栏代码块（含闭合行换行）
func maskFencedCodeBlocks(content string) string {
	buf := []byte(content)
	pos := 0
	for {
		openAt, ok := nextFenceOpenIndex(content, pos)
		if !ok {
			break
		}
		end := len(content)
		if closeAt, found := nextFenceOpenIndex(content, openAt+3); found {
			if lineEnd := strings.IndexByte(content[closeAt+3:], '\n'); lineEnd >= 0 {
				end = closeAt + 3 + lineEnd + 1
			}
		}
		for i := openAt; i < end; i++ {
			buf[i] = ' '
		}
		pos = end
	}
	return string(buf)
}

// nextFenceOpenIndex 等价前端 noteRefs.ts openRe.exec 语义：^ 仅匹配文本头，其余围栏必须出现在行首 \n 之后
func nextFenceOpenIndex(src string, pos int) (openAt int, ok bool) {
	if pos == 0 {
		if loc := fenceLineHeadRe.FindStringIndex(src); loc != nil && loc[0] == 0 {
			return 0, true
		}
	}
	loc := fenceLineSeekRe.FindStringIndex(src[pos:])
	if loc == nil {
		return 0, false
	}
	return pos + loc[1] - 3, true
}

// maskInlineCodeSpans 与前端 noteRefs.ts 保持一致：遮蔽行内代码双反引号/单反引号区间（含两端标记）
func maskInlineCodeSpans(content string) string {
	buf := []byte(content)
	i := 0
	for i < len(content) {
		if content[i] != '`' {
			i++
			continue
		}
		j := i
		for j < len(content) && content[j] == '`' {
			j++
		}
		fence := content[i:j]
		closeAt := strings.Index(content[j:], fence)
		if closeAt < 0 {
			i = j
			continue
		}
		closeAt += j
		end := closeAt + len(fence)
		for p := i; p < end; p++ {
			buf[p] = ' '
		}
		i = end
	}
	return string(buf)
}

func maskCode(content string) string {
	return maskInlineCodeSpans(maskFencedCodeBlocks(content))
}

// ExtractPlaceholderRefs 按系统统一的引用占位符语法提取引用：
// 全系统唯一语法 [[note_id=xxx|face=yyy|...]]，遮蔽代码区域，去重。
func ExtractPlaceholderRefs(content string) []Ref {
	refs := []Ref{}
	seen := map[string]bool{}
	text := maskCode(strings.ReplaceAll(content, "\r\n", "\n"))
	for {
		start := strings.Index(text, "[[")
		if start < 0 {
			break
		}
		text = text[start+2:]
		end := strings.Index(text, "]]")
		if end < 0 {
			break
		}
		inner := text[:end]
		text = text[end+2:]
		// 与前端 noteRefs.ts 单行约束保持一致：占位符内容出现换行不算有效引用，不提取
		if strings.Contains(inner, "\n") {
			continue
		}
		// 与前端 noteRefs.ts 正则 [^\]\n] 语义保持一致：占位符内容出现单个 ] 视为无效占位符，不提取
		if strings.Contains(inner, "]") {
			continue
		}
		ref, ok := parseNoteRefPlaceholder(inner)
		if !ok {
			continue
		}
		key := ref.NoteID + "\x00" + ref.FaceID
		if !seen[key] {
			seen[key] = true
			refs = append(refs, ref)
		}
	}
	return refs
}

func parseNoteRefPlaceholder(inner string) (Ref, bool) {
	noteID := ""
	faceID := ""
	for _, part := range strings.Split(inner, "|") {
		part = strings.TrimSpace(part)
		eq := strings.Index(part, "=")
		if eq < 0 {
			continue
		}
		value := strings.TrimSpace(part[eq+1:])
		// 与前端 parseNotePlaceholderBody 保持一致：重复键后写覆盖（含写空）
		switch strings.TrimSpace(part[:eq]) {
		case "note_id":
			noteID = value
		case "face":
			faceID = value
		}
	}
	if noteID == "" {
		return Ref{}, false
	}
	return Ref{NoteID: noteID, FaceID: faceID}, true
}

// UniqueRefs 去重并清理空目标，供引用索引规范化复用。
func UniqueRefs(refs []Ref) []Ref {
	seen := map[string]bool{}
	out := []Ref{}
	for _, ref := range refs {
		ref.NoteID = strings.TrimSpace(ref.NoteID)
		ref.FaceID = strings.TrimSpace(ref.FaceID)
		if ref.NoteID == "" {
			continue
		}
		key := ref.NoteID + "\x00" + ref.FaceID
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, ref)
	}
	return out
}
