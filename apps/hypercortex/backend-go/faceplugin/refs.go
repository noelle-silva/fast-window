package faceplugin

import (
	"strings"
)

// ExtractPlaceholderRefs 按系统统一的引用占位符语法提取引用：
// 全系统唯一语法 [[note_id=xxx|face=yyy|...]]，去重。
// 本函数只做纯语法解析，不感知任何面语言的代码区域；
// 代码区域遮蔽（如 markdown 围栏、html 代码标签）由各面插件在调用前自行完成。
func ExtractPlaceholderRefs(content string) []Ref {
	refs := []Ref{}
	seen := map[string]bool{}
	text := strings.ReplaceAll(content, "\r\n", "\n")
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
