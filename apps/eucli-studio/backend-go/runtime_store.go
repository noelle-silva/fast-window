package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"
)

const (
	runtimeStoragePrefix        = "runtime/"
	chatUpdatedNoticeRuntimeKey = "ui/notice/chat-updated"
	chatWriteLockLogicalPrefix  = "lock.chat."
)

type runtimeLockResult struct {
	Acquired  bool   `json:"acquired,omitempty"`
	Renewed   bool   `json:"renewed,omitempty"`
	Released  bool   `json:"released,omitempty"`
	Owner     string `json:"owner,omitempty"`
	ExpiresAt int64  `json:"expiresAt,omitempty"`
	Now       int64  `json:"now,omitempty"`
}

type runtimeLockLease struct {
	Owner     string `json:"owner"`
	ExpiresAt int64  `json:"expiresAt"`
}

type runtimeStore struct {
	mu     sync.RWMutex
	values map[string]any
}

func newRuntimeStore() *runtimeStore {
	return &runtimeStore{values: map[string]any{}}
}

// runtimeLogicalKey marks the boundary between durable business writes and
// runtime-only coordination data. Values under runtime/ are locks, notices, and
// other UI/backend handshake facts; they must stay in the backend runtime root
// instead of being projected into e-b business storage. Keeping this boundary
// explicit prevents temporary UI coordination from silently becoming durable
// domain state.
func runtimeLogicalKey(storageKey string) (string, bool) {
	key := strings.TrimSpace(storageKey)
	if !strings.HasPrefix(key, runtimeStoragePrefix) {
		return "", false
	}
	logicalKey := strings.TrimPrefix(key, runtimeStoragePrefix)
	if strings.TrimSpace(logicalKey) == "" {
		return "", false
	}
	return logicalKey, true
}

func (s *runtimeStore) get(key string) (any, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.values[key]
	return value, ok
}

func (s *runtimeStore) set(key string, value any) {
	s.mu.Lock()
	s.values[key] = value
	s.mu.Unlock()
}

func (s *runtimeStore) remove(key string) {
	s.mu.Lock()
	delete(s.values, key)
	s.mu.Unlock()
}

func (s *runtimeStore) acquireLock(key string, owner string, nowMs int64, ttlMs int64) runtimeLockResult {
	next := runtimeLockLease{Owner: strings.TrimSpace(owner), ExpiresAt: nowMs + ttlMs}

	s.mu.Lock()
	defer s.mu.Unlock()

	cur, exists := runtimeLockLeaseFromValue(s.values[key])
	if !exists || cur.ExpiresAt <= nowMs || cur.Owner == next.Owner {
		s.values[key] = next
		return runtimeLockResult{Acquired: true, Owner: next.Owner, ExpiresAt: next.ExpiresAt, Now: nowMs}
	}
	return runtimeLockResult{Acquired: false, Owner: cur.Owner, ExpiresAt: cur.ExpiresAt, Now: nowMs}
}

func (s *runtimeStore) renewLock(key string, owner string, nowMs int64, ttlMs int64) runtimeLockResult {
	owner = strings.TrimSpace(owner)

	s.mu.Lock()
	defer s.mu.Unlock()

	cur, exists := runtimeLockLeaseFromValue(s.values[key])
	if !exists || cur.Owner != owner || cur.ExpiresAt <= nowMs {
		if exists {
			return runtimeLockResult{Renewed: false, Owner: cur.Owner, ExpiresAt: cur.ExpiresAt, Now: nowMs}
		}
		return runtimeLockResult{Renewed: false, Now: nowMs}
	}

	next := runtimeLockLease{Owner: owner, ExpiresAt: nowMs + ttlMs}
	s.values[key] = next
	return runtimeLockResult{Renewed: true, Owner: next.Owner, ExpiresAt: next.ExpiresAt, Now: nowMs}
}

func (s *runtimeStore) releaseLock(key string, owner string, nowMs int64) runtimeLockResult {
	owner = strings.TrimSpace(owner)

	s.mu.Lock()
	defer s.mu.Unlock()

	cur, exists := runtimeLockLeaseFromValue(s.values[key])
	if !exists {
		return runtimeLockResult{Released: false, Now: nowMs}
	}
	if cur.Owner != owner {
		return runtimeLockResult{Released: false, Owner: cur.Owner, ExpiresAt: cur.ExpiresAt, Now: nowMs}
	}
	delete(s.values, key)
	return runtimeLockResult{Released: true, Owner: cur.Owner, ExpiresAt: cur.ExpiresAt, Now: nowMs}
}

func runtimeLockLeaseFromValue(value any) (runtimeLockLease, bool) {
	switch v := value.(type) {
	case runtimeLockLease:
		return normalizeRuntimeLockLease(v)
	case *runtimeLockLease:
		if v == nil {
			return runtimeLockLease{}, false
		}
		return normalizeRuntimeLockLease(*v)
	case map[string]any:
		return normalizeRuntimeLockLease(runtimeLockLease{Owner: strings.TrimSpace(fmt.Sprint(v["owner"])), ExpiresAt: runtimeInt64(v["expiresAt"])})
	case map[string]string:
		return normalizeRuntimeLockLease(runtimeLockLease{Owner: strings.TrimSpace(v["owner"]), ExpiresAt: runtimeInt64(v["expiresAt"])})
	default:
		return runtimeLockLease{}, false
	}
}

func normalizeRuntimeLockLease(lease runtimeLockLease) (runtimeLockLease, bool) {
	lease.Owner = strings.TrimSpace(lease.Owner)
	if lease.Owner == "" || lease.ExpiresAt <= 0 {
		return runtimeLockLease{}, false
	}
	return lease, true
}

func runtimeInt64(value any) int64 {
	switch v := value.(type) {
	case int:
		return int64(v)
	case int8:
		return int64(v)
	case int16:
		return int64(v)
	case int32:
		return int64(v)
	case int64:
		return v
	case uint:
		return int64(v)
	case uint8:
		return int64(v)
	case uint16:
		return int64(v)
	case uint32:
		return int64(v)
	case uint64:
		return int64(v)
	case float32:
		return int64(v)
	case float64:
		return int64(v)
	case json.Number:
		if n, err := v.Int64(); err == nil {
			return n
		}
		if f, err := v.Float64(); err == nil {
			return int64(f)
		}
	case string:
		text := strings.TrimSpace(v)
		if n, err := strconv.ParseInt(text, 10, 64); err == nil {
			return n
		}
		if f, err := strconv.ParseFloat(text, 64); err == nil {
			return int64(f)
		}
	}
	return 0
}
