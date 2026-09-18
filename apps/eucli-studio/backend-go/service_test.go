package main

import (
	"context"
	"encoding/json"
	"testing"
)

func TestRuntimeStorageStaysInRuntimeRoot(t *testing.T) {
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	svc := newBusinessReadyTestService(store, nil)
	ctx := context.Background()
	key := "runtime/lock.chat.role.role-1.chat-1"

	setPayload, _ := json.Marshal(map[string]any{
		"key":   key,
		"value": map[string]any{"owner": "owner-1", "expiresAt": float64(123)},
	})
	if _, err := svc.dispatch(ctx, "aiChat.storageSet", setPayload); err != nil {
		t.Fatalf("runtime storageSet should not reach projection: %v", err)
	}

	getPayload, _ := json.Marshal(map[string]any{"key": key})
	got, err := svc.dispatch(ctx, "aiChat.storageGet", getPayload)
	if err != nil {
		t.Fatalf("runtime storageGet error = %v", err)
	}
	gotMap := objectMap(got)
	if gotMap["owner"] != "owner-1" {
		t.Fatalf("runtime value = %#v", gotMap)
	}

	if _, err := svc.dispatch(ctx, "aiChat.storageRemove", getPayload); err != nil {
		t.Fatalf("runtime storageRemove error = %v", err)
	}
	got, err = svc.dispatch(ctx, "aiChat.storageGet", getPayload)
	if err != nil {
		t.Fatalf("runtime storageGet after remove error = %v", err)
	}
	if got != nil {
		t.Fatalf("runtime value after remove = %#v", got)
	}
}

func TestChatUpdatedNoticeUsesRuntimeStorage(t *testing.T) {
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	svc := newBusinessReadyTestService(store, nil)
	ctx := context.Background()
	key := "runtime/" + chatUpdatedNoticeRuntimeKey

	setPayload, _ := json.Marshal(map[string]any{
		"key": key,
		"value": map[string]any{
			"id":         "notice-1",
			"targetKind": "role",
			"targetId":   "role-1",
			"chatId":     "chat-1",
			"updatedAt":  float64(456),
		},
	})
	if _, err := svc.dispatch(ctx, "aiChat.storageSet", setPayload); err != nil {
		t.Fatalf("chat-updated notice should not reach projection: %v", err)
	}

	getPayload, _ := json.Marshal(map[string]any{"key": key})
	got, err := svc.dispatch(ctx, "aiChat.storageGet", getPayload)
	if err != nil {
		t.Fatalf("chat-updated notice get error = %v", err)
	}
	gotMap := objectMap(got)
	if gotMap["id"] != "notice-1" || gotMap["chatId"] != "chat-1" {
		t.Fatalf("chat-updated notice = %#v", gotMap)
	}
}
