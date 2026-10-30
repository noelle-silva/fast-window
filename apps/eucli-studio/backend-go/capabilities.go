package main

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
)

// 能力协商（design-1 决策 6 / P3 灰度）。
//
// healthCheck.features 是「studio 后端**真的能提供**的能力清单」，
// 不是「studio 代码里写了哪些方法」。
//
// 两者的差别在依赖外部服务的那些能力上：
//
//	session.window  → 依赖 eucli-box 的 GET .../window 端点
//	session.get     → 依赖 box 的 profile 裁剪
//
// 若 studio 后端单独上线而 box 还是旧版，无条件声明这些 feature 会让前端
// 立刻切到新路径并打到不存在的端点 —— 所有会话加载失败。
//
// 因此这里区分三类：
//
//	localFeatures    studio 自己就能兑现（索引组装 / 偏好命令 / 迁移垫片）
//	boxFeatures      需要 box 配合（由 box 的 release 资料声明）
//	gatedFeatures    studio 有实现但依赖 box 能力，只有 box 声明时才暴露
//
// 探测结果按「连接身份」缓存：连接换代才重新探测，避免每次 healthCheck 都打 box。

const (
	featureSessionIndexGet    = "sessionIndex.get"
	featureSessionSummaryList = "sessionSummary.list"
	featureSessionGet         = "session.get"
	featureSessionWindow      = "session.window"
	featureSessionViewPatch   = "session.view.patch"
	featureSetActiveChat      = "setActiveChat"
	featureStorageGetMany     = "storageGetMany"
	featureRevisionLayered    = "revisionLayered"
	featureServerBusy         = "serverBusy"
	featureCancelFrame        = "cancelFrame"
	featureTimeoutBudget      = "timeoutBudget"
	featureSessionGraph       = "session.graph"
)

// localFeatureFlags 是 studio 后端自身即可兑现的能力：
// 索引由读模型组装、偏好命令只写本地投影、storageGetMany 是纯转发。
func localFeatureFlags() []string {
	return []string{
		featureSessionIndexGet,
		featureSessionSummaryList,
		featureSetActiveChat,
		featureStorageGetMany,
		featureRevisionLayered,
		featureServerBusy,
		featureCancelFrame,
		featureTimeoutBudget,
	}
}

// gatedFeatureDependencies 是「studio 有实现、但依赖 box 端点」的能力及其依赖名。
// 只有 box 在 release 资料里声明了对应能力，studio 才对外暴露。
var gatedFeatureDependencies = map[string]string{
	featureSessionGet:       "session.profile",
	featureSessionWindow:    "session.window",
	featureSessionViewPatch: "session.view",
	featureSessionGraph:     "session.graph",
}

type boxCapabilityProbe struct {
	mu       sync.RWMutex
	key      string
	features map[string]struct{}
}

func newBoxCapabilityProbe() *boxCapabilityProbe {
	return &boxCapabilityProbe{features: map[string]struct{}{}}
}

// remember 记录某次连接身份下的 box 能力集合。
// key 是连接身份（地址 + 版本），换代时才需要重新探测。
func (p *boxCapabilityProbe) remember(key string, features []string) {
	next := make(map[string]struct{}, len(features))
	for _, feature := range features {
		name := strings.TrimSpace(feature)
		if name != "" {
			next[name] = struct{}{}
		}
	}
	p.mu.Lock()
	p.key = key
	p.features = next
	p.mu.Unlock()
}

// supports 判断当前连接身份下 box 是否声明了某能力。
// 连接身份不匹配（还没探测 / 已换代）时一律返回 false：灰度默认关闭。
func (p *boxCapabilityProbe) supports(connectionKey string, feature string) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if connectionKey == "" || p.key != connectionKey {
		return false
	}
	_, ok := p.features[strings.TrimSpace(feature)]
	return ok
}

// effective 返回当前连接身份下 studio 对外暴露的完整能力清单。
func (p *boxCapabilityProbe) effective(connectionKey string) []string {
	out := append([]string{}, localFeatureFlags()...)
	p.mu.RLock()
	sameConnection := connectionKey != "" && p.key == connectionKey
	declared := p.features
	p.mu.RUnlock()
	if !sameConnection {
		return out
	}
	// gated 能力按「box 声明了什么」逐项暴露，绝不无条件声明。
	for feature, dependency := range gatedFeatureDependencies {
		if _, ok := declared[dependency]; ok {
			out = append(out, feature)
		}
	}
	return out
}

// boxFeaturesFromRelease 从 /api/release 响应里读 box 声明的能力清单。
// 旧版 box 不返回该字段 → 空列表 → 所有 gated 能力保持关闭（正确的灰度默认）。
func boxFeaturesFromRelease(raw any) []string {
	payload, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	values, ok := payload["features"].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if name := strings.TrimSpace(toStringValue(value)); name != "" {
			out = append(out, name)
		}
	}
	return out
}

// probeBoxCapabilities 在连接建立后探测一次 box 能力并缓存。
// 探测失败不阻断 bootstrap：能力集合保持为空 = 全部 gated 关闭。
func (s *service) probeBoxCapabilities(ctx context.Context, connectionKey string, releaseRaw any) {
	if s.capabilities == nil || strings.TrimSpace(connectionKey) == "" {
		return
	}
	s.capabilities.remember(connectionKey, boxFeaturesFromRelease(releaseRaw))
}

// healthCheckFeatures 是 healthCheck.features 的唯一来源。
func (s *service) healthCheckFeatures() []string {
	if s.capabilities == nil {
		return localFeatureFlags()
	}
	return s.capabilities.effective(s.connectionIdentityKey())
}

// connectionIdentityKey 与读模型的换代判据同源：
// 地址 + box 版本 + 业务可用性。只有三者都稳定才算「同一次连接」。
func (s *service) connectionIdentityKey() string {
	state := s.connectionSnapshot()
	return connectionIdentity(state)
}

// decodeReleaseFeatures 只在需要单独取 features 时使用（bootstrap 已拿到 raw）。
func decodeReleaseFeatures(payload json.RawMessage) []string {
	if len(payload) == 0 {
		return nil
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil
	}
	return boxFeaturesFromRelease(decoded)
}
