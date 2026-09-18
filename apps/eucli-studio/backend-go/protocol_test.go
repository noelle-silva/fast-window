package main

import "testing"

func TestErrorPayloadForStructuredErrorDoesNotInventDetails(t *testing.T) {
	details := map[string]any{
		"status": float64(500),
		"error": map[string]any{
			"message": "outer failure",
			"cause":   map[string]any{"message": "raw leaf"},
		},
	}

	payload := errorPayloadFor("EB_REQUEST_FAILED", "请求失败", details)
	if payload == nil {
		t.Fatal("errorPayloadFor() returned nil")
	}
	if payload.Code != "" || payload.System != "" {
		t.Fatalf("payload should not invent code/system, got code=%q system=%q", payload.Code, payload.System)
	}
	if payload.Details != nil {
		t.Fatalf("payload details = %#v, want nil", payload.Details)
	}
	if payload.Cause == nil || payload.Cause.Message != "raw leaf" {
		t.Fatalf("payload cause = %#v", payload.Cause)
	}
	if payload.Cause.Details != nil {
		t.Fatalf("cause details = %#v, want nil", payload.Cause.Details)
	}
}

func TestResponseErrorFromMapPreservesParallelCauses(t *testing.T) {
	payload := responseErrorFromMap(map[string]any{
		"message": "outer failure",
		"causes": []any{
			map[string]any{"message": "raw leaf"},
			map[string]any{"code": "network.dns_failed", "message": "dns failed", "system": "network-request-system"},
		},
	})

	if payload == nil {
		t.Fatal("responseErrorFromMap() returned nil")
	}
	if len(payload.Causes) != 2 {
		t.Fatalf("parallel cause count = %d, want 2", len(payload.Causes))
	}
	if payload.Causes[0].Code != "" || payload.Causes[0].Message != "raw leaf" {
		t.Fatalf("first parallel cause = %#v", payload.Causes[0])
	}
	if payload.Causes[1].Code != "network.dns_failed" || payload.Causes[1].System != "network-request-system" {
		t.Fatalf("second parallel cause = %#v", payload.Causes[1])
	}
}
