package main

import (
	"context"
	"sync"
)

type aiHTTPRequest struct {
	Method    string            `json:"method"`
	URL       string            `json:"url"`
	Headers   map[string]string `json:"headers,omitempty"`
	Body      string            `json:"body,omitempty"`
	TimeoutMs int64             `json:"timeoutMs,omitempty"`
}

type aiRunTarget struct {
	Kind         string `json:"kind"`
	RoleID       string `json:"roleId,omitempty"`
	GroupID      string `json:"groupId,omitempty"`
	ChatID       string `json:"chatId"`
	BranchID     string `json:"branchId"`
	AssistantMid string `json:"assistantMid"`
	Tag          string `json:"tag,omitempty"`
	Service      string `json:"service,omitempty"`
}

type aiRunSpec struct {
	Target  aiRunTarget    `json:"target"`
	Stream  bool           `json:"stream"`
	JobStub map[string]any `json:"jobStub"`
}

type aiRawRunSpec struct {
	Target aiRunTarget   `json:"target"`
	Req    aiHTTPRequest `json:"req"`
	Stream bool          `json:"stream"`
}

type aiRun struct {
	ID        string
	Status    string
	ScopeKey  string
	Target    aiRunTarget
	Req       aiHTTPRequest
	Stream    bool
	CreatedAt int64
	StartedAt int64
	UpdatedAt int64

	mu              sync.Mutex
	output          string
	cancel          context.CancelFunc
	cancelRequested bool
	finalOnce       sync.Once
}

func (run *aiRun) setOutput(text string) {
	run.mu.Lock()
	run.output = text
	run.UpdatedAt = nowMs()
	run.mu.Unlock()
}

func (run *aiRun) currentOutput() string {
	run.mu.Lock()
	defer run.mu.Unlock()
	return run.output
}
