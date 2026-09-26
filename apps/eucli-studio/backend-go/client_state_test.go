package main

import (
	"context"
	"encoding/json"
	"testing"
)

// TestClientStateStoragePersistsAcrossRestart 验证客户端状态区的读写：
// 走客户端数据文件持久化，重建服务（模拟客户端重启）后仍能读回。
func TestClientStateStoragePersistsAcrossRestart(t *testing.T) {
	dir := t.TempDir()
	store, err := newConfigStore(dir)
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	svc := newBusinessReadyTestService(store, nil)
	ctx := context.Background()
	key := "client-state/tool-work-directory-prompted"

	setPayload, _ := json.Marshal(map[string]any{"key": key, "value": "1"})
	if _, err := svc.dispatch(ctx, "aiChat.storageSet", setPayload); err != nil {
		t.Fatalf("client state storageSet error = %v", err)
	}

	getPayload, _ := json.Marshal(map[string]any{"key": key})
	got, err := svc.dispatch(ctx, "aiChat.storageGet", getPayload)
	if err != nil {
		t.Fatalf("client state storageGet error = %v", err)
	}
	if got != "1" {
		t.Fatalf("client state value = %#v", got)
	}

	reopened, err := newConfigStore(dir)
	if err != nil {
		t.Fatalf("newConfigStore(reopen) error = %v", err)
	}
	restarted := newBusinessReadyTestService(reopened, nil)
	got, err = restarted.dispatch(ctx, "aiChat.storageGet", getPayload)
	if err != nil {
		t.Fatalf("client state storageGet after restart error = %v", err)
	}
	if got != "1" {
		t.Fatalf("client state value after restart = %#v", got)
	}

	if _, err := restarted.dispatch(ctx, "aiChat.storageRemove", getPayload); err != nil {
		t.Fatalf("client state storageRemove error = %v", err)
	}
	got, err = restarted.dispatch(ctx, "aiChat.storageGet", getPayload)
	if err != nil {
		t.Fatalf("client state storageGet after remove error = %v", err)
	}
	if got != nil {
		t.Fatalf("client state value after remove = %#v", got)
	}
}

// TestClientStateStorageWorksWithoutBusinessConnection 验证客户端状态读写
// 不依附 eucli-box 业务连接：未连接时照常可用。
func TestClientStateStorageWorksWithoutBusinessConnection(t *testing.T) {
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	svc, err := newService(store, testClientRelease(), nil)
	if err != nil {
		t.Fatalf("newService() error = %v", err)
	}
	ctx := context.Background()
	key := "client-state/example"

	setPayload, _ := json.Marshal(map[string]any{"key": key, "value": "ready"})
	if _, err := svc.dispatch(ctx, "aiChat.storageSet", setPayload); err != nil {
		t.Fatalf("client state storageSet without connection error = %v", err)
	}
	getPayload, _ := json.Marshal(map[string]any{"key": key})
	got, err := svc.dispatch(ctx, "aiChat.storageGet", getPayload)
	if err != nil {
		t.Fatalf("client state storageGet without connection error = %v", err)
	}
	if got != "ready" {
		t.Fatalf("client state value = %#v", got)
	}
}
