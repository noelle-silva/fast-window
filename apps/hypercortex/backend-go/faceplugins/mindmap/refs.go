package mindmap

import "fast-window-hypercortex-backend/faceplugin"

// ExtractRefs 遍历导图节点文本，提取系统引用占位符（统一语法 [[note_id=...|face=...]]）。
func ExtractRefs(content string) []faceplugin.Ref {
	root, ok := parseDocument(content)
	if !ok {
		return nil
	}
	refs := []faceplugin.Ref{}
	walkTexts(root, func(text string) {
		refs = append(refs, faceplugin.ExtractPlaceholderRefs(text)...)
	})
	return faceplugin.UniqueRefs(refs)
}
