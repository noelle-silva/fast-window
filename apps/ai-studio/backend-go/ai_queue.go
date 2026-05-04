package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

type aiRunQueue struct {
	svc       *service
	mu        sync.Mutex
	runs      map[string]*aiRun
	midToRun  map[string]string
	scopeBusy map[string]bool
	queued    []*aiRun
}

func newAIRunQueue(svc *service) *aiRunQueue {
	return &aiRunQueue{
		svc:       svc,
		runs:      map[string]*aiRun{},
		midToRun:  map[string]string{},
		scopeBusy: map[string]bool{},
		queued:    []*aiRun{},
	}
}

func (svc *service) submitChatCompletion(params json.RawMessage) (map[string]any, error) {
	var spec aiRunSpec
	if err := json.Unmarshal(params, &spec); err != nil {
		return nil, err
	}
	return svc.submitRunSpec(spec)
}

func (svc *service) submitManyChatCompletions(params json.RawMessage) (map[string]any, error) {
	var payload struct {
		Inputs []aiRunSpec `json:"inputs"`
	}
	if err := json.Unmarshal(params, &payload); err != nil {
		return nil, err
	}
	count := 0
	for _, spec := range payload.Inputs {
		if _, err := svc.submitRunSpec(spec); err != nil {
			return nil, err
		}
		count++
	}
	return map[string]any{"ok": true, "count": count}, nil
}

func (svc *service) submitRunSpec(spec aiRunSpec) (map[string]any, error) {
	target := normalizeRunTarget(spec.Target)
	mid := strings.TrimSpace(target.AssistantMid)
	if mid == "" {
		return nil, errors.New("assistantMid is required")
	}
	if err := svc.resetAssistantRuntimeByMid(mid); err != nil {
		return nil, err
	}

	var req aiHTTPRequest
	var err error
	if target.Kind == "group" {
		req, err = svc.buildOpenAIGroupChatReqFromStorage(spec.JobStub)
	} else {
		req, err = svc.buildOpenAIChatReqFromStorage(spec.JobStub)
	}
	if err != nil {
		return nil, err
	}
	run, err := svc.ai.enqueue(target, req, spec.Stream)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "runId": run.ID}, nil
}

func (svc *service) submitRawServiceRequest(params json.RawMessage) (map[string]any, error) {
	var spec aiRawRunSpec
	if err := json.Unmarshal(params, &spec); err != nil {
		return nil, err
	}
	target := normalizeRunTarget(spec.Target)
	mid := strings.TrimSpace(target.AssistantMid)
	if mid == "" {
		return nil, errors.New("assistantMid is required")
	}
	if err := svc.resetAssistantRuntimeByMid(mid); err != nil {
		return nil, err
	}
	run, err := svc.ai.enqueue(target, normalizeHTTPRequest(spec.Req), spec.Stream)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "runId": run.ID}, nil
}

func (svc *service) waitServiceFinal(params json.RawMessage) (string, error) {
	var payload struct {
		AssistantMid string `json:"assistantMid"`
		TimeoutMs    int64  `json:"timeoutMs"`
	}
	_ = json.Unmarshal(params, &payload)
	mid := strings.TrimSpace(payload.AssistantMid)
	if mid == "" {
		return "", errors.New("assistantMid is required")
	}
	timeoutMs := payload.TimeoutMs
	if timeoutMs < 2000 {
		timeoutMs = 2000
	}
	deadline := time.Now().Add(time.Duration(timeoutMs) * time.Millisecond)
	for time.Now().Before(deadline) {
		finalValue, err := svc.consumeAssistantFinalByMid(mid)
		if err != nil {
			return "", err
		}
		if finalValue != nil {
			status := strings.TrimSpace(asString(finalValue["status"]))
			text := asString(finalValue["text"])
			if status != "" && status != "succeeded" {
				if strings.TrimSpace(text) == "" {
					text = "请求失败"
				}
				return "", errors.New(text)
			}
			return text, nil
		}
		time.Sleep(120 * time.Millisecond)
	}
	return "", errors.New("AI 微服务请求超时（后台可能未启动或已卡住）")
}

func (svc *service) cancelAssistant(params json.RawMessage) (map[string]bool, error) {
	mid := requestAssistantMid(params)
	if mid == "" {
		return map[string]bool{"cancelled": false}, nil
	}
	return map[string]bool{"cancelled": true}, svc.ai.cancelAssistant(mid)
}

func (svc *service) readAssistantStream(params json.RawMessage) (any, error) {
	mid := requestAssistantMid(params)
	if mid == "" {
		return nil, nil
	}
	return svc.storageGetByKey(assistantStreamStorageKey(mid))
}

func (svc *service) consumeAssistantFinal(params json.RawMessage) (any, error) {
	mid := requestAssistantMid(params)
	if mid == "" {
		return nil, nil
	}
	return svc.consumeAssistantFinalByMid(mid)
}

func (svc *service) consumeAssistantFinalByMid(mid string) (map[string]any, error) {
	value, err := svc.storageGetByKey(assistantFinalStorageKey(mid))
	if err != nil {
		return nil, err
	}
	if value == nil {
		return nil, nil
	}
	_ = svc.storageRemoveByKey(assistantFinalStorageKey(mid))
	finalValue, _ := value.(map[string]any)
	if finalValue == nil {
		return map[string]any{"status": "succeeded", "text": asString(value)}, nil
	}
	return finalValue, nil
}

func (svc *service) resetAssistantRuntime(params json.RawMessage) (map[string]bool, error) {
	mid := requestAssistantMid(params)
	if mid == "" {
		return map[string]bool{"ok": true}, nil
	}
	return map[string]bool{"ok": true}, svc.resetAssistantRuntimeByMid(mid)
}

func (svc *service) resetAssistantRuntimeByMid(mid string) error {
	mid = strings.TrimSpace(mid)
	if mid == "" {
		return nil
	}
	_ = svc.storageRemoveByKey(assistantStreamStorageKey(mid))
	_ = svc.storageRemoveByKey(assistantFinalStorageKey(mid))
	_ = svc.storageRemoveByKey(assistantMidRunStorageKey(mid))
	return nil
}

func (q *aiRunQueue) enqueue(target aiRunTarget, req aiHTTPRequest, stream bool) (*aiRun, error) {
	target = normalizeRunTarget(target)
	if target.AssistantMid == "" || target.ChatID == "" || target.BranchID == "" {
		return nil, errors.New("enqueue: target 参数不完整")
	}
	if target.Kind == "group" {
		if target.GroupID == "" || target.RoleID == "" {
			return nil, errors.New("enqueue: group target 参数不完整")
		}
	} else if target.RoleID == "" {
		return nil, errors.New("enqueue: role target 参数不完整")
	}
	if strings.TrimSpace(req.URL) == "" {
		return nil, errors.New("enqueue: req.url is required")
	}
	now := nowMs()
	run := &aiRun{
		ID:        newRunID(),
		Status:    "queued",
		ScopeKey:  runScopeKey(target),
		Target:    target,
		Req:       normalizeHTTPRequest(req),
		Stream:    stream,
		CreatedAt: now,
		UpdatedAt: now,
	}

	q.mu.Lock()
	q.runs[run.ID] = run
	q.midToRun[target.AssistantMid] = run.ID
	q.queued = append(q.queued, run)
	q.mu.Unlock()

	_ = q.svc.storageSetByKey(assistantMidRunStorageKey(target.AssistantMid), map[string]any{"runId": run.ID, "createdAt": now})
	q.pump()
	return run, nil
}

func (q *aiRunQueue) cancelAssistant(assistantMid string) error {
	mid := strings.TrimSpace(assistantMid)
	if mid == "" {
		return nil
	}

	q.mu.Lock()
	run := q.findRunLocked(mid)
	if run == nil {
		q.mu.Unlock()
		return nil
	}
	run.mu.Lock()
	run.cancelRequested = true
	if run.Status == "queued" {
		run.Status = "canceled"
		q.removeQueuedLocked(run.ID)
	}
	cancel := run.cancel
	status := run.Status
	run.mu.Unlock()
	q.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if status == "canceled" {
		go q.finalize(run, "canceled", "（已停止）", "")
	}
	return nil
}

func (q *aiRunQueue) pump() {
	q.mu.Lock()
	defer q.mu.Unlock()

	for {
		idx := -1
		var picked *aiRun
		for i, run := range q.queued {
			if run == nil {
				continue
			}
			run.mu.Lock()
			status := run.Status
			scopeKey := run.ScopeKey
			run.mu.Unlock()
			if status == "queued" && !q.scopeBusy[scopeKey] {
				idx = i
				picked = run
				break
			}
		}
		if idx < 0 || picked == nil {
			return
		}
		q.queued = append(q.queued[:idx], q.queued[idx+1:]...)
		q.scopeBusy[picked.ScopeKey] = true
		ctx, cancel := context.WithCancel(context.Background())
		picked.mu.Lock()
		picked.Status = "running"
		picked.StartedAt = nowMs()
		picked.UpdatedAt = picked.StartedAt
		picked.cancel = cancel
		picked.mu.Unlock()
		go q.execute(ctx, picked)
	}
}

func (q *aiRunQueue) execute(ctx context.Context, run *aiRun) {
	lastFlushAt := int64(0)
	flush := func(force bool) {
		text := run.currentOutput()
		if !force && nowMs()-lastFlushAt < 220 {
			return
		}
		lastFlushAt = nowMs()
		_ = q.svc.storageSetByKey(assistantStreamStorageKey(run.Target.AssistantMid), map[string]any{"text": text, "updatedAt": nowMs()})
	}

	text, err := runOpenAIRequest(ctx, run.Req, run.Stream, func(delta string) {
		next := run.currentOutput() + delta
		run.setOutput(next)
		flush(false)
	})
	if text != "" {
		run.setOutput(text)
	}
	flush(true)

	run.mu.Lock()
	canceled := run.cancelRequested || ctx.Err() != nil
	run.mu.Unlock()

	if canceled {
		finalText := strings.TrimSpace(run.currentOutput())
		if finalText == "" {
			finalText = "（已停止）"
		}
		q.finalize(run, "canceled", finalText, "")
		return
	}
	if err != nil {
		msg := strings.TrimSpace(err.Error())
		finalText := strings.TrimSpace(run.currentOutput())
		if finalText == "" {
			finalText = fmt.Sprintf("（请求失败：%s）", msg)
		}
		q.finalize(run, "failed", finalText, msg)
		return
	}
	q.finalize(run, "succeeded", run.currentOutput(), "")
}

func (q *aiRunQueue) finalize(run *aiRun, status string, text string, errMsg string) {
	run.finalOnce.Do(func() {
		finishedAt := nowMs()
		run.mu.Lock()
		run.Status = status
		run.UpdatedAt = finishedAt
		run.mu.Unlock()

		finalValue := map[string]any{
			"status":     status,
			"text":       text,
			"finishedAt": finishedAt,
			"expiresAt":  finishedAt + 10*60*1000,
		}
		if errMsg != "" {
			finalValue["error"] = map[string]any{"message": errMsg}
		}
		_ = q.svc.storageSetByKey(assistantFinalStorageKey(run.Target.AssistantMid), finalValue)
		if strings.TrimSpace(run.Target.Tag) != "service" {
			_ = q.svc.patchAssistantMessageFinal(run.Target, status, text)
		}
		_ = q.svc.storageRemoveByKey(assistantStreamStorageKey(run.Target.AssistantMid))
		_ = q.svc.storageRemoveByKey(assistantMidRunStorageKey(run.Target.AssistantMid))

		q.mu.Lock()
		delete(q.scopeBusy, run.ScopeKey)
		delete(q.runs, run.ID)
		if q.midToRun[run.Target.AssistantMid] == run.ID {
			delete(q.midToRun, run.Target.AssistantMid)
		}
		q.mu.Unlock()
		q.pump()
	})
}

func (q *aiRunQueue) findRunLocked(assistantMid string) *aiRun {
	if runID := strings.TrimSpace(q.midToRun[assistantMid]); runID != "" {
		return q.runs[runID]
	}
	value, err := q.svc.storageGetByKey(assistantMidRunStorageKey(assistantMid))
	if err != nil || value == nil {
		return nil
	}
	box, _ := value.(map[string]any)
	runID := strings.TrimSpace(asString(box["runId"]))
	if runID == "" {
		return nil
	}
	return q.runs[runID]
}

func (q *aiRunQueue) removeQueuedLocked(runID string) {
	for i, run := range q.queued {
		if run != nil && run.ID == runID {
			q.queued = append(q.queued[:i], q.queued[i+1:]...)
			return
		}
	}
}

func normalizeRunTarget(target aiRunTarget) aiRunTarget {
	kind := "role"
	if strings.TrimSpace(target.Kind) == "group" {
		kind = "group"
	}
	branchID := normalizeBranchID(target.BranchID)
	return aiRunTarget{
		Kind:         kind,
		RoleID:       strings.TrimSpace(target.RoleID),
		GroupID:      strings.TrimSpace(target.GroupID),
		ChatID:       strings.TrimSpace(target.ChatID),
		BranchID:     branchID,
		AssistantMid: strings.TrimSpace(target.AssistantMid),
		Tag:          strings.TrimSpace(target.Tag),
		Service:      strings.TrimSpace(target.Service),
	}
}

func normalizeHTTPRequest(req aiHTTPRequest) aiHTTPRequest {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method == "" {
		method = "POST"
	}
	return aiHTTPRequest{
		Method:    method,
		URL:       strings.TrimSpace(req.URL),
		Headers:   req.Headers,
		Body:      req.Body,
		TimeoutMs: req.TimeoutMs,
	}
}

func runScopeKey(target aiRunTarget) string {
	targetID := target.RoleID
	if target.Kind == "group" {
		targetID = target.GroupID
	}
	return fmt.Sprintf("%s:%s/%s@%s", target.Kind, targetID, target.ChatID, target.BranchID)
}

func newRunID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err == nil {
		return fmt.Sprintf("run_%x_%d", buf, nowMs())
	}
	return fmt.Sprintf("run_%s_%d", hex.EncodeToString([]byte(fmt.Sprint(time.Now().UnixNano()))), nowMs())
}
