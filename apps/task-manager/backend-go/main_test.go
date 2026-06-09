package main

import (
	"encoding/json"
	"testing"
)

func rawParams(t *testing.T, value any) json.RawMessage {
	t.Helper()
	bytes, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return bytes
}

func TestTaskStoreLifecycle(t *testing.T) {
	svc := &service{dataDir: t.TempDir()}
	if err := svc.ensureReady(); err != nil {
		t.Fatalf("ensureReady failed: %v", err)
	}

	result, err := svc.dispatch("taskManager.boards.list", nil)
	if err != nil {
		t.Fatalf("list boards failed: %v", err)
	}
	boards := result.([]taskBoard)
	if len(boards) != 0 {
		t.Fatalf("expected empty boards, got %d", len(boards))
	}

	result, err = svc.dispatch("taskManager.boards.create", rawParams(t, map[string]string{"title": "Inbox", "description": "Capture"}))
	if err != nil {
		t.Fatalf("create board failed: %v", err)
	}
	board := result.(taskBoard)
	if board.Title != "Inbox" || board.Description != "Capture" {
		t.Fatalf("unexpected board: %+v", board)
	}

	result, err = svc.dispatch("taskManager.tasks.create", rawParams(t, map[string]string{"boardId": board.ID, "title": "Write plan", "description": "Keep it clear"}))
	if err != nil {
		t.Fatalf("create task failed: %v", err)
	}
	task := result.(taskItem)
	if task.Title != "Write plan" || task.Description != "Keep it clear" {
		t.Fatalf("unexpected task: %+v", task)
	}

	result, err = svc.dispatch("taskManager.tasks.update", rawParams(t, map[string]string{"boardId": board.ID, "taskId": task.ID, "title": "Write final plan", "description": "No shortcuts"}))
	if err != nil {
		t.Fatalf("update task failed: %v", err)
	}
	updated := result.(taskItem)
	if updated.Title != "Write final plan" || updated.Description != "No shortcuts" {
		t.Fatalf("unexpected updated task: %+v", updated)
	}

	result, err = svc.dispatch("taskManager.boards.list", nil)
	if err != nil {
		t.Fatalf("list boards after update failed: %v", err)
	}
	boards = result.([]taskBoard)
	if len(boards) != 1 || len(boards[0].Tasks) != 1 || boards[0].Tasks[0].Title != "Write final plan" {
		t.Fatalf("unexpected persisted state: %+v", boards)
	}
}

func TestRejectsEmptyTitles(t *testing.T) {
	svc := &service{dataDir: t.TempDir()}
	if err := svc.ensureReady(); err != nil {
		t.Fatalf("ensureReady failed: %v", err)
	}
	if _, err := svc.dispatch("taskManager.boards.create", rawParams(t, map[string]string{"title": " "})); err == nil {
		t.Fatal("expected empty board title to fail")
	}
}
