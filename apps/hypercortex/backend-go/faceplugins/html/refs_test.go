package html

import (
	"reflect"
	"testing"

	"fast-window-hypercortex-backend/faceplugin"
)

func TestExtractRefsSkipsScriptAndStyle(t *testing.T) {
	content := `<script>const x = "[[note_id=in-script]]"</script><style>/* [[note_id=in-style]] */</style><div>[[note_id=body]]</div>`
	refs := ExtractRefs(content)
	want := []faceplugin.Ref{{NoteID: "body"}}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("refs = %#v, want %#v", refs, want)
	}
}

func TestExtractRefsSkipsPreAndCode(t *testing.T) {
	content := "<pre><code>[[note_id=in-code]]</code></pre><code>[[note_id=in-inline-code]]</code><p>[[note_id=body|face=text]]</p>"
	refs := ExtractRefs(content)
	want := []faceplugin.Ref{{NoteID: "body", FaceID: "text"}}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("refs = %#v, want %#v", refs, want)
	}
}

func TestExtractRefsSkipsHtmlComments(t *testing.T) {
	content := "<!-- [[note_id=in-comment]] --><div>[[note_id=body]]</div><!-- multi\n[[note_id=in-multiline-comment]]\n-->"
	refs := ExtractRefs(content)
	want := []faceplugin.Ref{{NoteID: "body"}}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("refs = %#v, want %#v", refs, want)
	}
}

// 网页面不套用文本面的反引号遮蔽：反引号内外的引用都按正文提取
func TestExtractRefsDoesNotMaskBackticks(t *testing.T) {
	content := "<p>inline `[[note_id=kept]]` end</p>"
	refs := ExtractRefs(content)
	want := []faceplugin.Ref{{NoteID: "kept"}}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("refs = %#v, want %#v", refs, want)
	}
}

// 未闭合的代码标签不做遮蔽（保守提取，不吞正文引用）
func TestExtractRefsKeepsUnclosedTags(t *testing.T) {
	content := "<pre>[[note_id=kept-without-close]]"
	refs := ExtractRefs(content)
	want := []faceplugin.Ref{{NoteID: "kept-without-close"}}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("refs = %#v, want %#v", refs, want)
	}
}
