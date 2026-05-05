package main

import (
	"crypto/rand"
	"fmt"
	"sort"
	"sync"
)

type taskRegistry struct {
	mu    sync.Mutex
	tasks map[string]generationTask
	sink  eventSink
}

func newTaskRegistry(sink eventSink) *taskRegistry {
	if sink == nil {
		sink = noopEventSink{}
	}
	return &taskRegistry{tasks: map[string]generationTask{}, sink: sink}
}

func (registry *taskRegistry) create(input generationTaskInput) generationTask {
	now := nowMs()
	task := generationTask{
		ID:           generationID("gen"),
		Mode:         input.Mode,
		Status:       generationStatusPending,
		Prompt:       input.Prompt,
		CreatedAt:    now,
		UpdatedAt:    now,
		ProviderID:   input.ProviderID,
		ProviderName: input.ProviderName,
		Model:        input.Model,
		Cancel:       input.Cancel,
	}
	registry.mu.Lock()
	registry.tasks[task.ID] = task
	registry.mu.Unlock()
	registry.emit(eventGenerationCreated, task)
	return publicGenerationTask(task)
}

func (registry *taskRegistry) get(id string) any {
	registry.mu.Lock()
	defer registry.mu.Unlock()
	if task, ok := registry.tasks[id]; ok {
		public := publicGenerationTask(task)
		return public
	}
	return nil
}

func (registry *taskRegistry) list(limit int) []generationTask {
	registry.mu.Lock()
	items := make([]generationTask, 0, len(registry.tasks))
	for _, task := range registry.tasks {
		items = append(items, publicGenerationTask(task))
	}
	registry.mu.Unlock()
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt > items[j].CreatedAt })
	if limit <= 0 || limit > len(items) {
		limit = len(items)
	}
	return items[:limit]
}

func (registry *taskRegistry) update(id string, patch generationTaskPatch) (generationTask, bool) {
	registry.mu.Lock()
	task, ok := registry.tasks[id]
	if !ok {
		registry.mu.Unlock()
		return generationTask{}, false
	}
	applyTaskPatch(&task, patch)
	task.UpdatedAt = nowMs()
	registry.tasks[id] = task
	registry.mu.Unlock()
	registry.emit(eventNameForTaskStatus(task.Status), task)
	return publicGenerationTask(task), true
}

func (registry *taskRegistry) cancel(id string) bool {
	registry.mu.Lock()
	task, ok := registry.tasks[id]
	if !ok {
		registry.mu.Unlock()
		return false
	}
	if task.Status == generationStatusSucceeded || task.Status == generationStatusFailed || task.Status == generationStatusCanceled {
		registry.mu.Unlock()
		return true
	}
	cancel := task.Cancel
	task.Status = generationStatusCanceling
	task.UpdatedAt = nowMs()
	registry.tasks[id] = task
	registry.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	registry.emit(eventGenerationProgress, task)
	return true
}

func (registry *taskRegistry) dispose() {
	registry.mu.Lock()
	cancels := make([]func(), 0, len(registry.tasks))
	for _, task := range registry.tasks {
		if task.Cancel != nil {
			cancels = append(cancels, task.Cancel)
		}
	}
	registry.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}

func (registry *taskRegistry) emit(name string, task generationTask) {
	registry.sink.Broadcast(newEvent(name, map[string]any{"task": publicGenerationTask(task)}))
}

type generationTaskPatch struct {
	Status       *string
	ImageDataURL *string
	SavedPath    *string
	Error        *string
	Debug        *generationDebugRecord
}

func applyTaskPatch(task *generationTask, patch generationTaskPatch) {
	if patch.Status != nil {
		task.Status = *patch.Status
	}
	if patch.ImageDataURL != nil {
		task.ImageDataURL = *patch.ImageDataURL
	}
	if patch.SavedPath != nil {
		task.SavedPath = *patch.SavedPath
	}
	if patch.Error != nil {
		task.Error = *patch.Error
	}
	if patch.Debug != nil {
		task.Debug = patch.Debug
	}
}

func publicGenerationTask(task generationTask) generationTask {
	task.ProviderID = ""
	task.ProviderName = ""
	task.Model = ""
	task.Cancel = nil
	return task
}

func eventNameForTaskStatus(status string) string {
	switch status {
	case generationStatusSucceeded:
		return eventGenerationCompleted
	case generationStatusFailed:
		return eventGenerationFailed
	case generationStatusCanceled:
		return eventGenerationCanceled
	default:
		return eventGenerationProgress
	}
}

func generationID(prefix string) string {
	buf := make([]byte, 6)
	_, _ = rand.Read(buf)
	return fmt.Sprintf("%s-%d-%x", prefix, nowMs(), buf)
}

func stringPtr(value string) *string { return &value }
