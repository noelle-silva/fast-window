package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// 灰度硬门槛：healthCheck.features 必须反映 box 的实际能力。
//
// 反面场景：studio 后端单独上线、box 还是旧版（没有 /window 端点）。
// 若此时无条件声明 session.window，前端会立刻切窗口模式并全部加载失败。

func featureSet(list []string) map[string]struct{} {
	out := make(map[string]struct{}, len(list))
	for _, item := range list {
		out[item] = struct{}{}
	}
	return out
}

func hasFeature(list []string, feature string) bool {
	_, ok := featureSet(list)[feature]
	return ok
}

func newCapabilityTestService(t *testing.T, boxFeatures []string) *service {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/release" {
			payload := map[string]any{"version": "0.1.9"}
			if boxFeatures != nil {
				values := make([]any, 0, len(boxFeatures))
				for _, feature := range boxFeatures {
					values = append(values, feature)
				}
				payload["features"] = values
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": payload})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{}})
	}))
	t.Cleanup(server.Close)

	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.saveConnection(server.URL, "", false); err != nil {
		t.Fatalf("saveConnection() error = %v", err)
	}
	svc, err := newService(store, testClientRelease(), nil)
	if err != nil {
		t.Fatalf("newService() error = %v", err)
	}
	if _, err := svc.bootstrap(context.Background()); err != nil {
		t.Fatalf("bootstrap() error = %v", err)
	}
	return svc
}

// TestFeaturesOmitBoxDependentCapabilitiesWhenBoxDoesNotDeclareThem 钉住灰度默认：
// box 不声明任何能力（旧版）时，依赖 box 的 feature 一律不得出现。
func TestFeaturesOmitBoxDependentCapabilitiesWhenBoxDoesNotDeclareThem(t *testing.T) {
	svc := newCapabilityTestService(t, nil)
	features := svc.healthCheckFeatures()

	for _, gated := range []string{featureSessionWindow, featureSessionGet, featureSessionViewPatch, featureSessionGraph} {
		if hasFeature(features, gated) {
			t.Fatalf("box 未声明能力时不得暴露 %q：%#v", gated, features)
		}
	}
	// 本地能力必须始终可用。
	for _, local := range localFeatureFlags() {
		if !hasFeature(features, local) {
			t.Fatalf("本地能力 %q 必须始终暴露：%#v", local, features)
		}
	}
}

// TestFeaturesExposeBoxDependentCapabilitiesWhenBoxDeclaresThem 钉住正向灰度：
// box 声明了能力，studio 才把对应 feature 暴露给前端。
func TestFeaturesExposeBoxDependentCapabilitiesWhenBoxDeclaresThem(t *testing.T) {
	svc := newCapabilityTestService(t, []string{"session.window", "session.profile", "session.view", "session.graph"})
	features := svc.healthCheckFeatures()

	for _, gated := range []string{featureSessionWindow, featureSessionGet, featureSessionViewPatch, featureSessionGraph} {
		if !hasFeature(features, gated) {
			t.Fatalf("box 已声明能力，必须暴露 %q：%#v", gated, features)
		}
	}
}

// TestFeaturesArePerCapabilityNotAllOrNothing 钉住「逐项暴露」：
// box 只声明 window 时，session.get 等其它 gated 能力不得被顺带打开。
func TestFeaturesArePerCapabilityNotAllOrNothing(t *testing.T) {
	svc := newCapabilityTestService(t, []string{"session.window"})
	features := svc.healthCheckFeatures()

	if !hasFeature(features, featureSessionWindow) {
		t.Fatalf("应暴露 session.window：%#v", features)
	}
	for _, other := range []string{featureSessionGet, featureSessionViewPatch, featureSessionGraph} {
		if hasFeature(features, other) {
			t.Fatalf("box 未声明时不得暴露 %q：%#v", other, features)
		}
	}
}

// TestHealthCheckReportsProbedFeatures 钉住 healthCheck 的实际返回：
// features 走探测结果，不是静态列表。
func TestHealthCheckReportsProbedFeatures(t *testing.T) {
	svc := newCapabilityTestService(t, []string{"session.window"})
	result, err := svc.dispatch(context.Background(), "aiChat.healthCheck", nil)
	if err != nil {
		t.Fatalf("healthCheck error = %v", err)
	}
	features := stringSlice(objectMap(result)["features"])
	if !hasFeature(features, featureSessionWindow) {
		t.Fatalf("healthCheck 未反映探测到的 session.window：%#v", features)
	}
	if hasFeature(features, featureSessionGet) {
		t.Fatalf("healthCheck 不应暴露 box 未声明的 session.get：%#v", features)
	}
}

// TestFeaturesAreClosedBeforeAnyProbe 钉住「探测之前一律关闭」：
// 连接还没建立（或刚换代）时，gated 能力必须保持关闭。
func TestFeaturesAreClosedBeforeAnyProbe(t *testing.T) {
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	svc, err := newService(store, testClientRelease(), nil)
	if err != nil {
		t.Fatalf("newService() error = %v", err)
	}
	features := svc.healthCheckFeatures()
	if hasFeature(features, featureSessionWindow) {
		t.Fatalf("未探测时不得暴露 session.window：%#v", features)
	}
	if !hasFeature(features, featureSessionIndexGet) {
		t.Fatalf("本地能力必须可用：%#v", features)
	}
}

// TestProbeIsScopedToConnectionIdentity 钉住「探测结果按连接身份生效」：
// 连接换代后旧能力集合不得继续生效。
func TestProbeIsScopedToConnectionIdentity(t *testing.T) {
	probe := newBoxCapabilityProbe()
	probe.remember("conn-a", []string{"session.window"})
	if !probe.supports("conn-a", "session.window") {
		t.Fatalf("同一连接身份应命中探测结果")
	}
	if probe.supports("conn-b", "session.window") {
		t.Fatalf("连接身份不同时不得沿用旧能力集合")
	}
	if hasFeature(probe.effective("conn-b"), featureSessionWindow) {
		t.Fatalf("连接身份不同时不得暴露 gated 能力")
	}
}

// TestHealthCheckFeaturesAreLiveAfterProbe 钉住审查偏差 D 的 Go 侧契约：
// healthCheck.features 必须是「每次读取都最新」，而不是服务启动时的静态快照。
// 前端在 bootstrap 之后重新握手时，必须能拿到 bootstrap 探测出的 gated 能力。
func TestHealthCheckFeaturesAreLiveAfterProbe(t *testing.T) {
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	svc, err := newService(store, testClientRelease(), nil)
	if err != nil {
		t.Fatalf("newService() error = %v", err)
	}
	// 连接身份必须存在，否则探测结果无法归属（这是 probe 的前置条件）。
	svc.setConnectionState(runtimeBootstrap{
		EucliBoxURL:       "http://127.0.0.1:9",
		EucliBoxVersion:   "0.1.9",
		BusinessAvailable: true,
	})

	// 探测之前：gated 能力必须关闭。
	if hasFeature(svc.healthCheckFeatures(), featureSessionWindow) {
		t.Fatal("探测之前不得暴露 gated 能力")
	}

	// 探测完成（连接身份与 healthCheckFeatures 的判据同源）。
	key := svc.connectionIdentityKey()
	if key == "" {
		t.Fatal("连接身份为空，探测结果无法归属")
	}
	svc.probeBoxCapabilities(context.Background(), key, map[string]any{"features": []any{"session.window"}})

	// 同一 service、不重建：探测结果必须立刻对 healthCheck 可见。
	if !hasFeature(svc.healthCheckFeatures(), featureSessionWindow) {
		t.Fatalf("探测完成后 healthCheck 必须立刻反映新能力：%#v", svc.healthCheckFeatures())
	}
	// 本地能力始终可用。
	if !hasFeature(svc.healthCheckFeatures(), featureSessionIndexGet) {
		t.Fatalf("本地能力必须始终可用：%#v", svc.healthCheckFeatures())
	}
}
