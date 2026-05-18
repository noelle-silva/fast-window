package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	assetUploadStatusQueued    = "queued"
	assetUploadStatusRunning   = "running"
	assetUploadStatusPaused    = "paused"
	assetUploadStatusCompleted = "completed"
	assetUploadStatusFailed    = "failed"
	assetUploadStatusCanceled  = "canceled"

	assetUploadFileStatusPending   = "pending"
	assetUploadFileStatusRunning   = "running"
	assetUploadFileStatusCompleted = "completed"
	assetUploadFileStatusFailed    = "failed"
	assetUploadFileStatusCanceled  = "canceled"
)

var errAssetUploadCanceled = errors.New("上传任务已取消")

type assetUploadTaskStore struct {
	mu    sync.Mutex
	seq   int64
	tasks map[string]*assetUploadTask
}

type assetUploadTask struct {
	mu   sync.Mutex
	cond *sync.Cond

	ID              string                `json:"id"`
	Scope           string                `json:"scope"`
	Status          string                `json:"status"`
	Files           []assetUploadTaskFile `json:"files"`
	Result          []resourceRef         `json:"result,omitempty"`
	Error           string                `json:"error,omitempty"`
	TotalBytes      int64                 `json:"totalBytes"`
	UploadedBytes   int64                 `json:"uploadedBytes"`
	CurrentFileID   string                `json:"currentFileId,omitempty"`
	CreatedMs       float64               `json:"createdMs"`
	StartedMs       float64               `json:"startedMs,omitempty"`
	UpdatedMs       float64               `json:"updatedMs"`
	CompletedMs     float64               `json:"completedMs,omitempty"`
	pauseRequested  bool
	cancelRequested bool
	commitStarted   bool
}

type assetUploadTaskFile struct {
	ID            string       `json:"id"`
	Name          string       `json:"name"`
	Path          string       `json:"path"`
	Size          int64        `json:"size"`
	UploadedBytes int64        `json:"uploadedBytes"`
	Status        string       `json:"status"`
	Error         string       `json:"error,omitempty"`
	Resource      *resourceRef `json:"resource,omitempty"`
}

type assetUploadTaskSnapshot struct {
	ID            string                    `json:"id"`
	Scope         string                    `json:"scope"`
	Status        string                    `json:"status"`
	Files         []assetUploadFileSnapshot `json:"files"`
	Result        []resourceRef             `json:"result,omitempty"`
	Error         string                    `json:"error,omitempty"`
	TotalBytes    int64                     `json:"totalBytes"`
	UploadedBytes int64                     `json:"uploadedBytes"`
	Progress      float64                   `json:"progress"`
	CurrentFileID string                    `json:"currentFileId,omitempty"`
	CreatedMs     float64                   `json:"createdMs"`
	StartedMs     float64                   `json:"startedMs,omitempty"`
	UpdatedMs     float64                   `json:"updatedMs"`
	CompletedMs   float64                   `json:"completedMs,omitempty"`
}

type assetUploadFileSnapshot struct {
	ID            string       `json:"id"`
	Name          string       `json:"name"`
	Path          string       `json:"path"`
	Size          int64        `json:"size"`
	UploadedBytes int64        `json:"uploadedBytes"`
	Progress      float64      `json:"progress"`
	Status        string       `json:"status"`
	Error         string       `json:"error,omitempty"`
	Resource      *resourceRef `json:"resource,omitempty"`
}

func newAssetUploadTaskStore() *assetUploadTaskStore {
	return &assetUploadTaskStore{tasks: map[string]*assetUploadTask{}}
}

func (store *assetUploadTaskStore) create(scope string, files []assetUploadTaskFile) *assetUploadTask {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.seq++
	now := nowMs()
	task := &assetUploadTask{
		ID:        fmt.Sprintf("asset-upload-%d-%d", time.Now().UnixMilli(), store.seq),
		Scope:     scope,
		Status:    assetUploadStatusQueued,
		Files:     files,
		CreatedMs: now,
		UpdatedMs: now,
	}
	for _, file := range files {
		task.TotalBytes += file.Size
	}
	task.cond = sync.NewCond(&task.mu)
	store.tasks[task.ID] = task
	return task
}

func (store *assetUploadTaskStore) list() []assetUploadTaskSnapshot {
	store.mu.Lock()
	tasks := make([]*assetUploadTask, 0, len(store.tasks))
	for _, task := range store.tasks {
		tasks = append(tasks, task)
	}
	store.mu.Unlock()

	snapshots := make([]assetUploadTaskSnapshot, 0, len(tasks))
	for _, task := range tasks {
		snapshots = append(snapshots, task.snapshot())
	}
	sort.Slice(snapshots, func(i, j int) bool { return snapshots[i].CreatedMs > snapshots[j].CreatedMs })
	return snapshots
}

func (store *assetUploadTaskStore) get(id string) (*assetUploadTask, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()
	task, ok := store.tasks[strings.TrimSpace(id)]
	return task, ok
}

func (store *assetUploadTaskStore) remove(id string) {
	store.mu.Lock()
	defer store.mu.Unlock()
	delete(store.tasks, strings.TrimSpace(id))
}

func newAssetUploadTaskFiles(inputs []assetUploadFileInput) []assetUploadTaskFile {
	files := make([]assetUploadTaskFile, 0, len(inputs))
	for index, input := range inputs {
		path := strings.TrimSpace(input.Path)
		name := strings.TrimSpace(input.DisplayName)
		if name == "" {
			name = strings.TrimSpace(input.Name)
		}
		if name == "" && path != "" {
			name = strings.TrimSpace(filepath.Base(path))
		}
		size := fileSizeOrZero(path)
		if size == 0 && input.Size > 0 {
			size = input.Size
		}
		files = append(files, assetUploadTaskFile{
			ID:     fmt.Sprintf("file-%d", index+1),
			Name:   name,
			Path:   path,
			Size:   size,
			Status: assetUploadFileStatusPending,
		})
	}
	return files
}

func fileSizeOrZero(path string) int64 {
	info, err := os.Stat(strings.TrimSpace(path))
	if err != nil || info == nil || info.IsDir() {
		return 0
	}
	return info.Size()
}

func (task *assetUploadTask) snapshot() assetUploadTaskSnapshot {
	task.mu.Lock()
	defer task.mu.Unlock()
	files := make([]assetUploadFileSnapshot, 0, len(task.Files))
	for _, file := range task.Files {
		files = append(files, assetUploadFileSnapshot{
			ID:            file.ID,
			Name:          file.Name,
			Path:          file.Path,
			Size:          file.Size,
			UploadedBytes: file.UploadedBytes,
			Progress:      percent(file.UploadedBytes, file.Size),
			Status:        file.Status,
			Error:         file.Error,
			Resource:      cloneResourceRefPtr(file.Resource),
		})
	}
	return assetUploadTaskSnapshot{
		ID:            task.ID,
		Scope:         task.Scope,
		Status:        task.Status,
		Files:         files,
		Result:        append([]resourceRef(nil), task.Result...),
		Error:         task.Error,
		TotalBytes:    task.TotalBytes,
		UploadedBytes: task.UploadedBytes,
		Progress:      percent(task.UploadedBytes, task.TotalBytes),
		CurrentFileID: task.CurrentFileID,
		CreatedMs:     task.CreatedMs,
		StartedMs:     task.StartedMs,
		UpdatedMs:     task.UpdatedMs,
		CompletedMs:   task.CompletedMs,
	}
}

func (task *assetUploadTask) markRunning() error {
	task.mu.Lock()
	defer task.mu.Unlock()
	if task.cancelRequested || task.Status == assetUploadStatusCanceled {
		return errAssetUploadCanceled
	}
	now := nowMs()
	task.StartedMs = now
	task.UpdatedMs = now
	if task.pauseRequested {
		task.Status = assetUploadStatusPaused
		return nil
	}
	task.Status = assetUploadStatusRunning
	return nil
}

func (task *assetUploadTask) startFile(index int) error {
	if err := task.waitIfPausedOrCanceled(); err != nil {
		return err
	}
	task.mu.Lock()
	defer task.mu.Unlock()
	if index < 0 || index >= len(task.Files) {
		return nil
	}
	task.Status = assetUploadStatusRunning
	task.Files[index].Status = assetUploadFileStatusRunning
	task.CurrentFileID = task.Files[index].ID
	task.UpdatedMs = nowMs()
	return nil
}

func (task *assetUploadTask) addProgress(index int, delta int64) error {
	if err := task.waitIfPausedOrCanceled(); err != nil {
		return err
	}
	task.mu.Lock()
	defer task.mu.Unlock()
	if index >= 0 && index < len(task.Files) {
		task.Files[index].UploadedBytes += delta
	}
	task.UploadedBytes += delta
	task.UpdatedMs = nowMs()
	return nil
}

func (task *assetUploadTask) completeFile(index int, resource resourceRef) {
	task.mu.Lock()
	defer task.mu.Unlock()
	if index < 0 || index >= len(task.Files) {
		return
	}
	task.Files[index].Status = assetUploadFileStatusCompleted
	task.Files[index].Resource = &resource
	if task.Files[index].Size > task.Files[index].UploadedBytes {
		delta := task.Files[index].Size - task.Files[index].UploadedBytes
		task.Files[index].UploadedBytes += delta
		task.UploadedBytes += delta
	}
	task.UpdatedMs = nowMs()
}

func (task *assetUploadTask) failFile(index int, err error) {
	task.mu.Lock()
	defer task.mu.Unlock()
	if index >= 0 && index < len(task.Files) {
		task.Files[index].Status = assetUploadFileStatusFailed
		task.Files[index].Error = errorMessage(err)
	}
	task.UpdatedMs = nowMs()
}

func (task *assetUploadTask) markCompleted(result []resourceRef) {
	task.mu.Lock()
	defer task.mu.Unlock()
	if task.cancelRequested && !task.commitStarted {
		return
	}
	now := nowMs()
	task.Status = assetUploadStatusCompleted
	task.Result = append([]resourceRef(nil), result...)
	task.CurrentFileID = ""
	task.CompletedMs = now
	task.UpdatedMs = now
}

func (task *assetUploadTask) markFailed(err error) {
	task.mu.Lock()
	defer task.mu.Unlock()
	now := nowMs()
	message := errorMessage(err)
	task.Status = assetUploadStatusFailed
	task.Error = message
	task.CurrentFileID = ""
	task.CompletedMs = now
	task.UpdatedMs = now
	for i := range task.Files {
		if task.Files[i].Status == assetUploadFileStatusCompleted || task.Files[i].Status == assetUploadFileStatusFailed {
			continue
		}
		task.Files[i].Status = assetUploadFileStatusFailed
		if task.Files[i].Error == "" {
			task.Files[i].Error = message
		}
	}
}

func (task *assetUploadTask) markCanceled() {
	task.mu.Lock()
	defer task.mu.Unlock()
	now := nowMs()
	task.Status = assetUploadStatusCanceled
	task.CurrentFileID = ""
	task.CompletedMs = now
	task.UpdatedMs = now
	for i := range task.Files {
		if task.Files[i].Status == assetUploadFileStatusPending || task.Files[i].Status == assetUploadFileStatusRunning {
			task.Files[i].Status = assetUploadFileStatusCanceled
		}
	}
}

func (task *assetUploadTask) pause() assetUploadTaskSnapshot {
	task.mu.Lock()
	if task.Status == assetUploadStatusQueued || task.Status == assetUploadStatusRunning {
		task.pauseRequested = true
		task.Status = assetUploadStatusPaused
		task.UpdatedMs = nowMs()
	}
	task.mu.Unlock()
	return task.snapshot()
}

func (task *assetUploadTask) resume() assetUploadTaskSnapshot {
	task.mu.Lock()
	if task.Status == assetUploadStatusPaused {
		task.pauseRequested = false
		task.Status = assetUploadStatusRunning
		task.UpdatedMs = nowMs()
		task.cond.Broadcast()
	}
	task.mu.Unlock()
	return task.snapshot()
}

func (task *assetUploadTask) cancel() assetUploadTaskSnapshot {
	task.mu.Lock()
	if task.commitStarted || task.Status != assetUploadStatusQueued && task.Status != assetUploadStatusRunning && task.Status != assetUploadStatusPaused {
		task.mu.Unlock()
		return task.snapshot()
	}
	task.cancelRequested = true
	task.pauseRequested = false
	task.Status = assetUploadStatusCanceled
	task.UpdatedMs = nowMs()
	for i := range task.Files {
		if task.Files[i].Status == assetUploadFileStatusPending || task.Files[i].Status == assetUploadFileStatusRunning {
			task.Files[i].Status = assetUploadFileStatusCanceled
		}
	}
	task.cond.Broadcast()
	task.mu.Unlock()
	return task.snapshot()
}

func (task *assetUploadTask) beginCommit() error {
	task.mu.Lock()
	defer task.mu.Unlock()
	if task.cancelRequested {
		return errAssetUploadCanceled
	}
	task.commitStarted = true
	task.Status = assetUploadStatusRunning
	task.UpdatedMs = nowMs()
	return nil
}

func (task *assetUploadTask) waitIfPausedOrCanceled() error {
	task.mu.Lock()
	defer task.mu.Unlock()
	for task.pauseRequested && !task.cancelRequested {
		task.Status = assetUploadStatusPaused
		task.UpdatedMs = nowMs()
		task.cond.Wait()
	}
	if task.cancelRequested {
		return errAssetUploadCanceled
	}
	if task.Status == assetUploadStatusPaused {
		task.Status = assetUploadStatusRunning
		task.UpdatedMs = nowMs()
	}
	return nil
}

func percent(done int64, total int64) float64 {
	if total <= 0 {
		if done > 0 {
			return 100
		}
		return 0
	}
	value := float64(done) * 100 / float64(total)
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func cloneResourceRefPtr(input *resourceRef) *resourceRef {
	if input == nil {
		return nil
	}
	copy := *input
	return &copy
}

func errorMessage(err error) string {
	if err == nil {
		return ""
	}
	return strings.TrimSpace(err.Error())
}
