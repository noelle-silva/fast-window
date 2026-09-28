package main

import (
	"reflect"
	"testing"
)

// seedRelationIndex 构造固定的引用事实图（全仓库唯一事实源：谁引用了谁）：
// a→b、b→c、c→a（环）、d→a、e→f（无关子图）、g→g（自环）。
func seedRelationIndex(t *testing.T, svc *service) string {
	t.Helper()
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	idx := noteRefIndex{
		"a": {"text": {{NoteID: "b"}}},
		"b": {"html": {{NoteID: "c"}}},
		"c": {"text": {{NoteID: "a"}}},
		"d": {"text": {{NoteID: "a"}}},
		"e": {"text": {{NoteID: "f"}}},
		"g": {"text": {{NoteID: "g"}}},
	}
	if err := svc.saveRefIndex(scope, idx); err != nil {
		t.Fatal(err)
	}
	return scope
}

func assertRelationResult(t *testing.T, got refRelationResult, want refRelationResult) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("relations = %#v\nwant %#v", got, want)
	}
}

// 缺省方向 both、缺省半径 1：直接出链与被引用都在，且边界内诱导出全部真实引用边。
func TestQueryRefRelationsDefaultsToBothDirectionsAndOneHop(t *testing.T) {
	svc := newTestService(t)
	scope := seedRelationIndex(t, svc)

	got, err := svc.queryRefRelations(scope, "a", 0, "")
	if err != nil {
		t.Fatalf("query failed: %v", err)
	}
	assertRelationResult(t, got, refRelationResult{
		Nodes: []refRelationNode{
			{NoteID: "a"},
			{NoteID: "b", Distance: 1},
			{NoteID: "c", Distance: 1},
			{NoteID: "d", Distance: 1},
		},
		Edges: []refRelationEdge{
			{FromNoteID: "a", FromFaceID: "text", ToNoteID: "b"},
			{FromNoteID: "b", FromFaceID: "html", ToNoteID: "c"},
			{FromNoteID: "c", FromFaceID: "text", ToNoteID: "a"},
			{FromNoteID: "d", FromFaceID: "text", ToNoteID: "a"},
		},
	})
}

// 引用边完整携带来源面与目标面：目标面来自占位符的 face 参数，反向视角同样保留；
// 未指定目标面时目标面为空。
func TestQueryRefRelationsCarriesSourceAndTargetFaces(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	idx := noteRefIndex{
		"p": {"text": {{NoteID: "q", FaceID: "html"}, {NoteID: "r"}}},
	}
	if err := svc.saveRefIndex(scope, idx); err != nil {
		t.Fatal(err)
	}

	outgoing, err := svc.queryRefRelations(scope, "p", 1, "outgoing")
	if err != nil {
		t.Fatalf("outgoing query failed: %v", err)
	}
	assertRelationResult(t, outgoing, refRelationResult{
		Nodes: []refRelationNode{{NoteID: "p"}, {NoteID: "q", Distance: 1}, {NoteID: "r", Distance: 1}},
		Edges: []refRelationEdge{
			{FromNoteID: "p", FromFaceID: "text", ToNoteID: "q", ToFaceID: "html"},
			{FromNoteID: "p", FromFaceID: "text", ToNoteID: "r"},
		},
	})

	incoming, err := svc.queryRefRelations(scope, "q", 1, "incoming")
	if err != nil {
		t.Fatalf("incoming query failed: %v", err)
	}
	assertRelationResult(t, incoming, refRelationResult{
		Nodes: []refRelationNode{{NoteID: "q"}, {NoteID: "p", Distance: 1}},
		Edges: []refRelationEdge{
			{FromNoteID: "p", FromFaceID: "text", ToNoteID: "q", ToFaceID: "html"},
		},
	})
}

// 方向过滤与半径扩展：outgoing 只向主动引用展开、incoming 只向被引用展开；半径为跳数，遇环终止。
func TestQueryRefRelationsDirectionAndRadius(t *testing.T) {
	svc := newTestService(t)
	scope := seedRelationIndex(t, svc)

	outgoing, err := svc.queryRefRelations(scope, "a", 1, "outgoing")
	if err != nil {
		t.Fatalf("outgoing query failed: %v", err)
	}
	assertRelationResult(t, outgoing, refRelationResult{
		Nodes: []refRelationNode{{NoteID: "a"}, {NoteID: "b", Distance: 1}},
		Edges: []refRelationEdge{{FromNoteID: "a", FromFaceID: "text", ToNoteID: "b"}},
	})

	incoming, err := svc.queryRefRelations(scope, "a", 1, "incoming")
	if err != nil {
		t.Fatalf("incoming query failed: %v", err)
	}
	assertRelationResult(t, incoming, refRelationResult{
		Nodes: []refRelationNode{{NoteID: "a"}, {NoteID: "c", Distance: 1}, {NoteID: "d", Distance: 1}},
		Edges: []refRelationEdge{
			{FromNoteID: "c", FromFaceID: "text", ToNoteID: "a"},
			{FromNoteID: "d", FromFaceID: "text", ToNoteID: "a"},
		},
	})

	// 半径 2：链式扩展到 c；环边 c→a 作为边界内真实引用边一并返回。
	twoHops, err := svc.queryRefRelations(scope, "a", 2, "outgoing")
	if err != nil {
		t.Fatalf("two-hop query failed: %v", err)
	}
	assertRelationResult(t, twoHops, refRelationResult{
		Nodes: []refRelationNode{{NoteID: "a"}, {NoteID: "b", Distance: 1}, {NoteID: "c", Distance: 2}},
		Edges: []refRelationEdge{
			{FromNoteID: "a", FromFaceID: "text", ToNoteID: "b"},
			{FromNoteID: "b", FromFaceID: "html", ToNoteID: "c"},
			{FromNoteID: "c", FromFaceID: "text", ToNoteID: "a"},
		},
	})

	// 更大半径不会无限扩张：环已闭合，结果与 2 跳一致。
	fiveHops, err := svc.queryRefRelations(scope, "a", 5, "outgoing")
	if err != nil {
		t.Fatalf("five-hop query failed: %v", err)
	}
	assertRelationResult(t, fiveHops, twoHops)

	// 方向大小写不敏感。
	upper, err := svc.queryRefRelations(scope, "a", 1, "Outgoing")
	if err != nil {
		t.Fatalf("uppercase direction query failed: %v", err)
	}
	assertRelationResult(t, upper, outgoing)
}

// 自引用保留自环；无关子图只返回可达的一端；非法方向与空笔记标识快速失败。
func TestQueryRefRelationsSelfReferenceIsolatedAndInvalid(t *testing.T) {
	svc := newTestService(t)
	scope := seedRelationIndex(t, svc)

	self, err := svc.queryRefRelations(scope, "g", 1, "both")
	if err != nil {
		t.Fatalf("self-reference query failed: %v", err)
	}
	assertRelationResult(t, self, refRelationResult{
		Nodes: []refRelationNode{{NoteID: "g"}},
		Edges: []refRelationEdge{{FromNoteID: "g", FromFaceID: "text", ToNoteID: "g"}},
	})

	isolated, err := svc.queryRefRelations(scope, "e", 1, "both")
	if err != nil {
		t.Fatalf("isolated query failed: %v", err)
	}
	assertRelationResult(t, isolated, refRelationResult{
		Nodes: []refRelationNode{{NoteID: "e"}, {NoteID: "f", Distance: 1}},
		Edges: []refRelationEdge{{FromNoteID: "e", FromFaceID: "text", ToNoteID: "f"}},
	})

	if _, err := svc.queryRefRelations(scope, "a", 1, "sideways"); err == nil {
		t.Fatal("unknown direction must be rejected")
	}
	if _, err := svc.queryRefRelations(scope, "   ", 1, "both"); err == nil {
		t.Fatal("blank noteId must be rejected")
	}
}

// RPC 入口：参数按 scope、noteId、radius、direction 接线，缺省与显式方向行为一致。
func TestQueryRefRelationsDispatch(t *testing.T) {
	svc := newTestService(t)
	scope := seedRelationIndex(t, svc)

	result, err := svc.dispatch("hypercortex.refs.queryRelations", mustJSONRaw(t, map[string]any{
		"scope":  scope,
		"noteId": "a",
		"radius": 1,
	}))
	if err != nil {
		t.Fatalf("dispatch failed: %v", err)
	}
	relations, ok := result.(refRelationResult)
	if !ok {
		t.Fatalf("result = %#v", result)
	}
	assertRelationResult(t, relations, refRelationResult{
		Nodes: []refRelationNode{
			{NoteID: "a"},
			{NoteID: "b", Distance: 1},
			{NoteID: "c", Distance: 1},
			{NoteID: "d", Distance: 1},
		},
		Edges: []refRelationEdge{
			{FromNoteID: "a", FromFaceID: "text", ToNoteID: "b"},
			{FromNoteID: "b", FromFaceID: "html", ToNoteID: "c"},
			{FromNoteID: "c", FromFaceID: "text", ToNoteID: "a"},
			{FromNoteID: "d", FromFaceID: "text", ToNoteID: "a"},
		},
	})

	filtered, err := svc.dispatch("hypercortex.refs.queryRelations", mustJSONRaw(t, map[string]any{
		"scope":     scope,
		"noteId":    "a",
		"radius":    1,
		"direction": "incoming",
	}))
	if err != nil {
		t.Fatalf("dispatch with direction failed: %v", err)
	}
	assertRelationResult(t, filtered.(refRelationResult), refRelationResult{
		Nodes: []refRelationNode{{NoteID: "a"}, {NoteID: "c", Distance: 1}, {NoteID: "d", Distance: 1}},
		Edges: []refRelationEdge{
			{FromNoteID: "c", FromFaceID: "text", ToNoteID: "a"},
			{FromNoteID: "d", FromFaceID: "text", ToNoteID: "a"},
		},
	})
}
