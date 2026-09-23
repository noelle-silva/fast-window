package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"eucli-studio-backend/internal/ebcontract"
)

type runtimeBootstrap struct {
	ClientVersion               string                      `json:"clientVersion"`
	ClientEucliBoxCompatibility ebcontract.EucliBoxCompatibility `json:"clientEucliBoxCompatibility"`
	EucliBoxConfigured          bool                        `json:"eucliBoxConfigured"`
	EucliBoxReachable           bool                        `json:"eucliBoxReachable"`
	EucliBoxURL                 string                      `json:"eucliBoxUrl"`
	EucliBoxVersion             string                      `json:"eucliBoxVersion,omitempty"`
	EucliBoxCompatibility       *ebcontract.CompatibilityStatus  `json:"eucliBoxCompatibility,omitempty"`
	BusinessAvailable           bool                        `json:"businessAvailable"`
	EucliBoxIssue               string                      `json:"eucliBoxIssue,omitempty"`
}

func (s *service) bootstrap(ctx context.Context) (runtimeBootstrap, error) {
	cfg, err := s.config.load()
	if err != nil {
		return runtimeBootstrap{}, err
	}
	info := runtimeBootstrap{
		ClientVersion:               s.release.Version,
		ClientEucliBoxCompatibility: s.release.EucliBoxCompatibility,
		EucliBoxURL:                 cfg.EucliBoxURL,
	}
	if strings.TrimSpace(cfg.EucliBoxURL) == "" {
		info.EucliBoxIssue = "EUCLI_BOX_NOT_CONFIGURED: 请先配置业务端地址与访问 Key"
		s.setConnectionState(info)
		return info, nil
	}
	info.EucliBoxConfigured = true
	if cfg.EucliBoxDisconnected {
		info.EucliBoxIssue = "已退出当前连接，地址与 Key 已保留，点「保存并连接」即可重连。"
		s.setConnectionState(info)
		return info, nil
	}
	return s.bootstrapConnected(ctx, info)
}

func (s *service) bootstrapConnected(ctx context.Context, info runtimeBootstrap) (runtimeBootstrap, error) {
	if connection, err := s.currentBoxConnection(); err == nil {
		info.EucliBoxConfigured = true
		info.EucliBoxURL = connection.BaseURL
	}
	raw, err := s.eb.request(ctx, ebRequest{Method: "GET", Path: "/api/release", Timeout: 8000})
	if err != nil {
		info.EucliBoxIssue = err.Error()
		s.setConnectionState(info)
		return info, nil
	}
	info.EucliBoxReachable = true
	boxRelease, err := decodeBoxRelease(raw)
	if err != nil {
		info.EucliBoxIssue = err.Error()
		s.setConnectionState(info)
		return info, nil
	}
	info.EucliBoxVersion = boxRelease.Version
	info.EucliBoxCompatibility = boxRelease.ClientCompatibility
	if boxRelease.ClientCompatibility == nil {
		info.EucliBoxIssue = "eucli-box 未返回客户端适用判断"
	} else if !boxRelease.ClientCompatibility.Compatible {
		info.EucliBoxIssue = strings.TrimSpace(boxRelease.ClientCompatibility.Reason)
		if info.EucliBoxIssue == "" {
			info.EucliBoxIssue = "eucli-box 返回了不适用状态，但未提供原因"
		}
	} else if !sameCompatibility(boxRelease.ClientCompatibility.RequiredEucliBoxCompatibility, s.release.EucliBoxCompatibility) {
		info.EucliBoxIssue = "eucli-box 返回的客户端适用范围与客户端发布资料不一致"
	} else {
		info.BusinessAvailable = true
	}
	s.setConnectionState(info)
	return info, nil
}

func decodeBoxRelease(raw any) (ebcontract.EucliBoxReleaseInfo, error) {
	payload, err := json.Marshal(raw)
	if err != nil {
		return ebcontract.EucliBoxReleaseInfo{}, fmt.Errorf("读取 eucli-box 发布结果失败：%w", err)
	}
	var info ebcontract.EucliBoxReleaseInfo
	if err := json.Unmarshal(payload, &info); err != nil {
		return ebcontract.EucliBoxReleaseInfo{}, fmt.Errorf("读取 eucli-box 发布结果失败：%w", err)
	}
	if err := ebcontract.ValidateVersion(info.Version); err != nil {
		return ebcontract.EucliBoxReleaseInfo{}, fmt.Errorf("eucli-box 返回了无效版本：%w", err)
	}
	return info, nil
}

func sameCompatibility(left ebcontract.EucliBoxCompatibility, right ebcontract.EucliBoxCompatibility) bool {
	return left.MinimumVersion == right.MinimumVersion && left.MaximumVersionExclusive == right.MaximumVersionExclusive
}

func (s *service) requireBusinessConnection() error {
	s.connectionMu.RLock()
	state := s.connectionState
	s.connectionMu.RUnlock()
	if state == nil {
		return newError("EUCLI_BOX_CONNECTION_REQUIRED", "请先检查 eucli-box 连接和版本适用状态")
	}
	if !state.BusinessAvailable {
		message := strings.TrimSpace(state.EucliBoxIssue)
		if message == "" {
			message = "当前连接不可用于正常业务，但连接状态未提供原因"
		}
		return newErrorWithDetails("EUCLI_BOX_INCOMPATIBLE", message, *state)
	}
	return nil
}

func (s *service) setConnectionState(state runtimeBootstrap) {
	s.connectionMu.Lock()
	s.connectionState = &state
	s.connectionMu.Unlock()
	s.signalConnectionChanged()
}

func (s *service) clearConnectionState() {
	s.connectionMu.Lock()
	s.connectionState = nil
	s.connectionMu.Unlock()
	s.signalConnectionChanged()
}

func (s *service) connectionSnapshot() *runtimeBootstrap {
	s.connectionMu.RLock()
	defer s.connectionMu.RUnlock()
	if s.connectionState == nil {
		return nil
	}
	copy := *s.connectionState
	return &copy
}

func (s *service) signalConnectionChanged() {
	select {
	case s.connectionChanged <- struct{}{}:
	default:
	}
}
