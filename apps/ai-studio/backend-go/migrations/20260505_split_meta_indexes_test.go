package migrations

import (
	"path/filepath"
	"testing"
)

func TestSplitMetaIndexesMovesIndexesAndProvidersOutOfMeta(t *testing.T) {
	dataDir := t.TempDir()
	meta := map[string]any{
		"schemaVersion": 1,
		"dataVersion":   5,
		"updatedAt":     100,
		"settings": map[string]any{
			"streamEnabled": true,
			"providers": []any{
				map[string]any{"id": "OpenAI", "name": "OpenAI", "baseUrl": "https://api.openai.com/v1", "apiKey": "sk"},
			},
		},
		"roleOrder":   []any{"r1"},
		"roleFolders": map[string]any{"r1": "Alice"},
		"chatIndexByRole": map[string]any{
			"r1": map[string]any{"activeChatId": "c1", "chatIds": []any{"c1"}, "chatUpdatedAt": map[string]any{"c1": float64(200)}},
		},
		"groupOrder":   []any{"g1"},
		"groupFolders": map[string]any{"g1": "Team"},
		"chatIndexByGroup": map[string]any{
			"g1": map[string]any{"activeChatId": "gc1", "chatIds": []any{"gc1"}, "chatUpdatedAt": map[string]any{"gc1": float64(300)}},
		},
	}

	migration := SplitMetaIndexes()
	if err := migration.Apply(Context{DataDir: dataDir, Meta: meta}); err != nil {
		t.Fatal(err)
	}

	chatsIndex := readJSONForTest(t, filepath.Join(dataDir, "chats", "index.json"))
	if got := asSlice(chatsIndex["roleOrder"]); len(got) != 1 || asString(got[0]) != "r1" {
		t.Fatalf("roleOrder = %#v", chatsIndex["roleOrder"])
	}
	roleIndex := readJSONForTest(t, filepath.Join(dataDir, "chats", "Alice", "index.json"))
	if roleIndex["activeChatId"] != "c1" {
		t.Fatalf("role activeChatId = %v", roleIndex["activeChatId"])
	}
	groupsIndex := readJSONForTest(t, filepath.Join(dataDir, "groups", "index.json"))
	if got := asSlice(groupsIndex["groupOrder"]); len(got) != 1 || asString(got[0]) != "g1" {
		t.Fatalf("groupOrder = %#v", groupsIndex["groupOrder"])
	}
	groupIndex := readJSONForTest(t, filepath.Join(dataDir, "groups", "Team", "chats", "index.json"))
	if groupIndex["activeChatId"] != "gc1" {
		t.Fatalf("group activeChatId = %v", groupIndex["activeChatId"])
	}
	providersIndex := readJSONForTest(t, filepath.Join(dataDir, "providers", "index.json"))
	if got := asSlice(providersIndex["providerOrder"]); len(got) != 1 || asString(got[0]) != "OpenAI" {
		t.Fatalf("providerOrder = %#v", providersIndex["providerOrder"])
	}
	provider := readJSONForTest(t, filepath.Join(dataDir, "providers", "OpenAI", "provider.json"))
	if provider["id"] != "OpenAI" {
		t.Fatalf("provider id = %v", provider["id"])
	}

	if _, ok := meta["roleOrder"]; ok {
		t.Fatal("roleOrder should be removed from meta")
	}
	if _, ok := meta["chatIndexByRole"]; ok {
		t.Fatal("chatIndexByRole should be removed from meta")
	}
	settings := asMap(meta["settings"])
	if _, ok := settings["providers"]; ok {
		t.Fatal("providers should be removed from meta settings")
	}
}

func TestSplitMetaIndexesFailsForDifferentExistingTarget(t *testing.T) {
	dataDir := t.TempDir()
	writeJSONForTest(t, filepath.Join(dataDir, "providers", "index.json"), map[string]any{"schemaVersion": 1, "providerOrder": []any{"Other"}})
	meta := map[string]any{
		"schemaVersion": 1,
		"settings": map[string]any{
			"providers": []any{map[string]any{"id": "OpenAI", "name": "OpenAI"}},
		},
	}

	migration := SplitMetaIndexes()
	if err := migration.Apply(Context{DataDir: dataDir, Meta: meta}); err == nil {
		t.Fatal("expected conflict error")
	}
}
