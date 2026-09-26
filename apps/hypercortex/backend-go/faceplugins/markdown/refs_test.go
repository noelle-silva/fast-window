package markdown

import (
	"reflect"
	"testing"

	"fast-window-hypercortex-backend/faceplugin"
)

func TestExtractRefsSkipsFencedCodeBlocks(t *testing.T) {
	content := "before [[note_id=outside]]\n\n```js\n[[note_id=inside-fence]]\n```\n\ntext\n\n```\n[[note_id=unclosed-fence]]\n"
	refs := ExtractRefs(content)
	want := []faceplugin.Ref{{NoteID: "outside"}}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("refs = %#v, want %#v", refs, want)
	}
}

func TestExtractRefsSkipsInlineCodeSpans(t *testing.T) {
	content := "inline `[[note_id=inside-single]]` and ``[[note_id=inside-double]]`` and [[note_id=outside]]"
	refs := ExtractRefs(content)
	want := []faceplugin.Ref{{NoteID: "outside"}}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("refs = %#v, want %#v", refs, want)
	}
}

// 锁死围栏遮蔽边界：紧邻空围栏、"```\n```" 先闭合后未闭合均不越界遮蔽
func TestExtractRefsAdjacentFenceBlocks(t *testing.T) {
	content := "before [[note_id=before]]\n\n```\n```\n\n[[note_id=after]]\n\n```\nx\n\n```\n```\n\n[[note_id=after-empty-again]]\n\n```\n[[note_id=unclosed]]\n"
	refs := ExtractRefs(content)
	want := []faceplugin.Ref{{NoteID: "before"}, {NoteID: "after"}, {NoteID: "after-empty-again"}}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("refs = %#v, want %#v", refs, want)
	}
}

// 文本面提取保持统一占位符语法：face 参数保留、CRLF 归一、同键去重
func TestExtractRefsKeepsFaceParamAndDeduplicates(t *testing.T) {
	content := "[[note_id=target-a|face=html]]\r\n[[note_id=target-a|face=html]]\n[[note_id=target-b]]"
	refs := ExtractRefs(content)
	want := []faceplugin.Ref{{NoteID: "target-a", FaceID: "html"}, {NoteID: "target-b"}}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("refs = %#v, want %#v", refs, want)
	}
}
