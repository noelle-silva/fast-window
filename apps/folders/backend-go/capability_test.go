package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAddCollectionCategoryOptions(t *testing.T) {
	svc := readyService(t)

	result, err := queryCapabilityOptions(svc, capabilityQueryOptionsRequest{
		CapabilityID: capabilityAddCollection,
		OptionSource: optionSourceListCategories,
	})
	if err != nil {
		t.Fatal(err)
	}
	options, ok := result.([]capabilityOption)
	if !ok {
		t.Fatalf("unexpected category options result: %#v", result)
	}
	if len(options) != 3 || options[0].Value != "folder" || options[1].Value != "url" || options[2].Value != "file" {
		t.Fatalf("unexpected category options: %#v", options)
	}
}

func TestAddCollectionGroupOptions(t *testing.T) {
	svc := readyService(t)
	if _, err := svc.addCollectionGroup("url", collectionGroup{ID: "research", Name: "研究"}); err != nil {
		t.Fatal(err)
	}

	result, err := queryCapabilityOptions(svc, capabilityQueryOptionsRequest{
		CapabilityID: capabilityAddCollection,
		OptionSource: optionSourceListGroups,
		Config:       json.RawMessage(`{"categoryId":"url"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	options, ok := result.([]capabilityOption)
	if !ok {
		t.Fatalf("unexpected group options result: %#v", result)
	}
	if len(options) != 2 || options[0].Value != defaultGroupID || options[1].Value != "research" {
		t.Fatalf("unexpected url group options: %#v", options)
	}
}

func TestAddCollectionCapabilityAddsFolderURLAndFile(t *testing.T) {
	svc := readyService(t)
	for _, tc := range []struct {
		categoryID string
		input      string
		wantName   string
	}{
		{categoryID: "folder", input: `E:\Projects`, wantName: "Projects"},
		{categoryID: "url", input: "https://example.com/docs", wantName: "example.com"},
		{categoryID: "file", input: `E:\Docs\note.txt`, wantName: "note.txt"},
	} {
		result, err := invokeCapability(context.Background(), svc, capabilityInvokeRequest{
			CapabilityID: capabilityAddCollection,
			Input:        tc.input,
			Config:       json.RawMessage(`{"categoryId":"` + tc.categoryID + `","groupId":"default"}`),
		})
		if err != nil {
			t.Fatalf("%s add failed: %v", tc.categoryID, err)
		}
		created, ok := result.(addCollectionResult)
		if !ok || !created.OK || created.Text == "" || created.CategoryID != tc.categoryID || created.GroupID != defaultGroupID {
			t.Fatalf("unexpected %s add result: %#v", tc.categoryID, result)
		}

		view, err := svc.readWorkspaceView(tc.categoryID)
		if err != nil {
			t.Fatal(err)
		}
		if len(view.Items) != 1 || view.Items[0].Target.Kind != tc.categoryID || view.Items[0].GroupID != defaultGroupID || view.Items[0].Name != tc.wantName || view.Items[0].Icon != nil {
			t.Fatalf("unexpected %s created item: %#v", tc.categoryID, view.Items)
		}
	}
}

func TestAddCollectionCapabilityReturnsDisplayText(t *testing.T) {
	svc := readyService(t)
	if _, err := svc.addCollectionGroup("url", collectionGroup{ID: "research", Name: "研究"}); err != nil {
		t.Fatal(err)
	}

	result, err := invokeCapability(context.Background(), svc, capabilityInvokeRequest{
		CapabilityID: capabilityAddCollection,
		Input:        "https://example.com/docs",
		Config:       json.RawMessage(`{"categoryId":"url","groupId":"research"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	created, ok := result.(addCollectionResult)
	if !ok {
		t.Fatalf("unexpected add result: %#v", result)
	}
	if !strings.Contains(created.Text, "已添加到收藏集") || !strings.Contains(created.Text, "网址") || !strings.Contains(created.Text, "研究") {
		t.Fatalf("unexpected display text: %q", created.Text)
	}
}

func TestAddCollectionCapabilityRejectsInvalidConfig(t *testing.T) {
	svc := readyService(t)

	if _, err := queryCapabilityOptions(svc, capabilityQueryOptionsRequest{CapabilityID: "missing", OptionSource: optionSourceListCategories}); err == nil {
		t.Fatal("expected unknown capability to fail")
	}
	if _, err := queryCapabilityOptions(svc, capabilityQueryOptionsRequest{CapabilityID: capabilityAddCollection, OptionSource: "missing"}); err == nil {
		t.Fatal("expected unknown option source to fail")
	}
	if _, err := queryCapabilityOptions(svc, capabilityQueryOptionsRequest{CapabilityID: capabilityAddCollection, OptionSource: optionSourceListGroups, Config: json.RawMessage(`{"categoryId":`)}); err == nil {
		t.Fatal("expected invalid config json to fail")
	}
	if _, err := queryCapabilityOptions(svc, capabilityQueryOptionsRequest{CapabilityID: capabilityAddCollection, OptionSource: optionSourceListGroups}); err == nil {
		t.Fatal("expected missing categoryId to fail")
	}
	if _, err := invokeCapability(context.Background(), svc, capabilityInvokeRequest{CapabilityID: capabilityAddCollection, Input: "ftp://example.com", Config: json.RawMessage(`{"categoryId":"url","groupId":"default"}`)}); err == nil {
		t.Fatal("expected unsupported url protocol to fail")
	}
	if _, err := invokeCapability(context.Background(), svc, capabilityInvokeRequest{CapabilityID: capabilityAddCollection, Input: `E:\Projects`, Config: json.RawMessage(`{"categoryId":"folder"}`)}); err == nil {
		t.Fatal("expected missing groupId to fail")
	}
	if _, err := invokeCapability(context.Background(), svc, capabilityInvokeRequest{CapabilityID: capabilityAddCollection, Input: `E:\Projects`, Config: json.RawMessage(`{"categoryId":"folder","groupId":"missing"}`)}); err == nil {
		t.Fatal("expected missing group to fail")
	}
}

func TestBackendControlRejectsInvalidRequests(t *testing.T) {
	svc := readyService(t)
	server := &backendControlServer{svc: svc, token: "secret"}

	for _, tc := range []struct {
		name   string
		method string
		token  string
		body   string
		status int
	}{
		{name: "method", method: http.MethodGet, token: "secret", body: `{}`, status: http.StatusMethodNotAllowed},
		{name: "token", method: http.MethodPost, token: "wrong", body: `{}`, status: http.StatusForbidden},
		{name: "json", method: http.MethodPost, token: "secret", body: `{`, status: http.StatusBadRequest},
		{name: "action", method: http.MethodPost, token: "secret", body: `{"action":"missing"}`, status: http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "/control", strings.NewReader(tc.body))
			req.Header.Set("X-FW-Control-Token", tc.token)
			rec := httptest.NewRecorder()

			server.handleControl(rec, req)

			if rec.Code != tc.status {
				t.Fatalf("expected status %d, got %d body=%s", tc.status, rec.Code, rec.Body.String())
			}
		})
	}
}
