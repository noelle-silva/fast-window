package main

import (
	"reflect"
	"testing"
)

// 外部写入方法必须映射到正确的变更类别；只读方法不产生通知。
func TestChangeKindsForMethod(t *testing.T) {
	cases := []struct {
		method string
		want   []string
	}{
		{"hypercortex.notes.saveFaces", []string{changeKindNotes}},
		{"hypercortex.notes.create", []string{changeKindNotes}},
		{"hypercortex.notes.patchFace", []string{changeKindNotes}},
		{"hypercortex.favorites.createFolder", []string{changeKindFavorites}},
		{"hypercortex.favorites.addItem", []string{changeKindFavorites}},
		{"hypercortex.assets.delete", []string{changeKindAssets}},
		{"hypercortex.trash.moveNote", []string{changeKindNotes, changeKindTrash}},
		{"hypercortex.trash.moveFolder", []string{changeKindFavorites, changeKindTrash}},
		{"hypercortex.trash.restore", []string{changeKindNotes, changeKindFavorites, changeKindAssets, changeKindTrash}},
		{"hypercortex.notes.loadIndex", nil},
		{"hypercortex.refs.loadIndex", nil},
		{"hypercortex.search.query", nil},
		{"hypercortex.access.load", nil},
	}
	for _, tc := range cases {
		if got := changeKindsForMethod(tc.method); !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("changeKindsForMethod(%q) = %v, want %v", tc.method, got, tc.want)
		}
	}
}

// publish 推进仓库修订号并保持各仓库相互独立；空类别不产生通知也不推进修订。
func TestChangeHubRevision(t *testing.T) {
	hub := newChangeHub()
	if got := hub.revision("repo-a"); got != 0 {
		t.Fatalf("initial revision = %d, want 0", got)
	}
	hub.publish("repo-a", changeKindNotes)
	hub.publish("repo-a", changeKindFavorites)
	hub.publish("repo-b", changeKindNotes)
	hub.publish("repo-a") // 空类别：忽略

	if got := hub.revision("repo-a"); got != 2 {
		t.Fatalf("repo-a revision = %d, want 2", got)
	}
	if got := hub.revision("repo-b"); got != 1 {
		t.Fatalf("repo-b revision = %d, want 1", got)
	}
}

// 外部写入经访问出口后必须推进仓库修订号（通知已发出）；只读请求不推进。
func TestAccessServerPublishesChangeOnExternalWrite(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	repoID := testRepoID(t, svc)
	created, err := svc.createExternalAccessKey(repoID, "变更通知密钥")
	if err != nil {
		t.Fatalf("createExternalAccessKey failed: %v", err)
	}
	port, err := svc.accessServer.listen(0)
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}
	key := created.Keys[0].Key

	if got := svc.changes.revision(repoID); got != 0 {
		t.Fatalf("initial revision = %d, want 0", got)
	}

	write := postAccessRPC(t, port, key, `{"method":"hypercortex.favorites.createFolder","params":{"parentId":"root","title":"外部夹"}}`)
	if ok, message, _ := decodeAccessResponse(t, write); !ok {
		t.Fatalf("external write failed: %s", message)
	}
	if got := svc.changes.revision(repoID); got != 1 {
		t.Fatalf("revision after external write = %d, want 1", got)
	}

	read := postAccessRPC(t, port, key, `{"method":"hypercortex.favorites.tryLoad","params":{}}`)
	if ok, message, _ := decodeAccessResponse(t, read); !ok {
		t.Fatalf("external read failed: %s", message)
	}
	if got := svc.changes.revision(repoID); got != 1 {
		t.Fatalf("revision after read = %d, want 1 (read must not publish)", got)
	}
}
