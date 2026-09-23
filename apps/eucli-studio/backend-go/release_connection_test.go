package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"eucli-studio-backend/internal/ebcontract"
)

func TestLoadClientReleaseValidatesCompleteMetadata(t *testing.T) {
	info, err := loadClientRelease(`{"version":"0.1.9","eucliBoxCompatibility":{"minimumVersion":"0.1.0","maximumVersionExclusive":"0.2.0"}}`)
	if err != nil {
		t.Fatalf("loadClientRelease() error = %v", err)
	}
	if info.Version != "0.1.9" || info.EucliBoxCompatibility.MinimumVersion != "0.1.0" || info.EucliBoxCompatibility.MaximumVersionExclusive != "0.2.0" {
		t.Fatalf("release = %#v", info)
	}

	invalid := []string{
		`{"version":"0.1","eucliBoxCompatibility":{"minimumVersion":"0.1.0","maximumVersionExclusive":"0.2.0"}}`,
		`{"version":"0.1.9","eucliBoxCompatibility":{"minimumVersion":"0.2.0","maximumVersionExclusive":"0.1.0"}}`,
		`{"version":"0.1.9","eucliBoxCompatibility":{"minimumVersion":"0.1.0","maximumVersionExclusive":"0.2.0"},"unknown":true}`,
	}
	for _, source := range invalid {
		if _, err := loadClientRelease(source); err == nil {
			t.Fatalf("loadClientRelease(%s) should fail", source)
		}
	}
}

func TestEBClientAppliesReleaseHeaders(t *testing.T) {
	release := testClientRelease()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-Eucli-Studio-Version"); got != release.Version {
			t.Errorf("version header = %q", got)
		}
		if got := r.Header.Get("X-Eucli-Studio-Minimum-Box-Version"); got != release.EucliBoxCompatibility.MinimumVersion {
			t.Errorf("minimum header = %q", got)
		}
		if got := r.Header.Get("X-Eucli-Studio-Maximum-Box-Version"); got != release.EucliBoxCompatibility.MaximumVersionExclusive {
			t.Errorf("maximum header = %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"ok": true}})
	}))
	defer server.Close()

	store := configuredTestStore(t, server.URL)
	if _, err := newEBClient(store, release).request(context.Background(), ebRequest{Method: http.MethodGet, Path: "/test"}); err != nil {
		t.Fatalf("request() error = %v", err)
	}
}

func TestBootstrapRequiresCompatibleEucliBox(t *testing.T) {
	tests := []struct {
		name      string
		response  map[string]any
		available bool
	}{
		{
			name: "compatible",
			response: map[string]any{
				"version": "0.1.0",
				"clientCompatibility": map[string]any{
					"compatible":             true,
					"currentEucliBoxVersion": "0.1.0",
					"requiredEucliBoxCompatibility": map[string]any{
						"minimumVersion": "0.1.0", "maximumVersionExclusive": "0.2.0",
					},
				},
			},
			available: true,
		},
		{
			name: "incompatible",
			response: map[string]any{
				"version": "0.2.0",
				"clientCompatibility": map[string]any{
					"compatible":             false,
					"reason":                 "当前 eucli-box 版本不在所需范围",
					"currentEucliBoxVersion": "0.2.0",
					"requiredEucliBoxCompatibility": map[string]any{
						"minimumVersion": "0.1.0", "maximumVersionExclusive": "0.2.0",
					},
				},
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewEncoder(w).Encode(map[string]any{"data": test.response})
			}))
			defer server.Close()
			svc, err := newService(configuredTestStore(t, server.URL), testClientRelease(), nil)
			if err != nil {
				t.Fatalf("newService() error = %v", err)
			}
			info, err := svc.bootstrapConnected(context.Background(), runtimeBootstrap{})
			if err != nil {
				t.Fatalf("bootstrap() error = %v", err)
			}
			if info.BusinessAvailable != test.available {
				t.Fatalf("businessAvailable = %v, issue = %q", info.BusinessAvailable, info.EucliBoxIssue)
			}
			if !test.available && info.EucliBoxIssue == "" {
				t.Fatal("incompatible bootstrap should preserve the reason")
			}
		})
	}
}

func TestBootstrapManualConfigChain(t *testing.T) {
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	svc, err := newService(store, testClientRelease(), nil)
	if err != nil {
		t.Fatalf("newService() error = %v", err)
	}
	info, err := svc.bootstrap(context.Background())
	if err != nil {
		t.Fatalf("bootstrap() error = %v", err)
	}
	if info.EucliBoxConfigured || info.EucliBoxReachable {
		t.Fatalf("unconfigured bootstrap = %#v", info)
	}
	if info.EucliBoxIssue == "" {
		t.Fatal("unconfigured bootstrap should carry an issue")
	}
}

func TestBootstrapReportsDisconnectedStateWithoutDialing(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{}})
	}))
	defer server.Close()

	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.saveConnection(server.URL, "key-1", true); err != nil {
		t.Fatalf("saveConnection() error = %v", err)
	}
	svc, err := newService(store, testClientRelease(), nil)
	if err != nil {
		t.Fatalf("newService() error = %v", err)
	}

	info, err := svc.bootstrap(context.Background())
	if err != nil {
		t.Fatalf("bootstrap() error = %v", err)
	}
	if requests != 0 {
		t.Fatalf("disconnected bootstrap should not dial eucli-box, requests = %d", requests)
	}
	if info.BusinessAvailable || !info.EucliBoxConfigured {
		t.Fatalf("disconnected bootstrap = %#v", info)
	}
	if info.EucliBoxIssue == "" {
		t.Fatal("disconnected bootstrap should carry an issue")
	}
}

func TestBusinessMethodsRequireSuccessfulBootstrap(t *testing.T) {
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	svc, err := newService(store, testClientRelease(), nil)
	if err != nil {
		t.Fatalf("newService() error = %v", err)
	}
	_, err = svc.dispatch(context.Background(), "aiChat.storageGet", json.RawMessage(`{"key":"runtime/test"}`))
	var coded codedError
	if !errors.As(err, &coded) || coded.Code() != "EUCLI_BOX_CONNECTION_REQUIRED" {
		t.Fatalf("error = %#v", err)
	}

	svc.setConnectionState(runtimeBootstrap{BusinessAvailable: false, EucliBoxIssue: "版本不适用"})
	_, err = svc.dispatch(context.Background(), "aiChat.storageGet", json.RawMessage(`{"key":"runtime/test"}`))
	if !errors.As(err, &coded) || coded.Code() != "EUCLI_BOX_INCOMPATIBLE" {
		t.Fatalf("error = %#v", err)
	}
}

func TestReleaseCandidatesListPassesThroughWithoutState(t *testing.T) {
	requests := make(chan *http.Request, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r
		_ = json.NewEncoder(w).Encode(map[string]any{"data": ebcontract.ArtifactCandidateList{
			SourceKind: string(ebcontract.KindOfficial),
			Candidates: []ebcontract.ArtifactReleaseCandidate{{
				Artifact:      ebcontract.ReleaseArtifactIdentity{Kind: ebcontract.ReleaseArtifactKindPlugin, ID: "time-plugin"},
				LatestVersion: "0.1.0",
				Status:        ebcontract.ReleaseCandidateStatusCompleted,
			}},
		}})
	}))
	defer server.Close()

	svc, err := newService(configuredTestStore(t, server.URL), testClientRelease(), nil)
	if err != nil {
		t.Fatalf("newService() error = %v", err)
	}
	svc.setConnectionState(runtimeBootstrap{EucliBoxReachable: true})

	list, err := svc.listReleaseCandidates(context.Background(), "plugin")
	if err != nil {
		t.Fatalf("listReleaseCandidates() error = %v", err)
	}
	if list.SourceKind != string(ebcontract.KindOfficial) || len(list.Candidates) != 1 || list.Candidates[0].Artifact.ID != "time-plugin" {
		t.Fatalf("list = %#v", list)
	}
	request := <-requests
	if request.Method != http.MethodGet || request.URL.Path != "/api/release-candidates" || request.URL.Query().Get("kind") != "plugin" {
		t.Fatalf("unexpected request: %s %s?%s", request.Method, request.URL.Path, request.URL.RawQuery)
	}
	// 客户端不保存任何候选结果：第二次读取仍打到业务端。
	if _, err := svc.listReleaseCandidates(context.Background(), "plugin"); err != nil {
		t.Fatalf("second listReleaseCandidates() error = %v", err)
	}
	<-requests
}

func TestArtifactInstallationsListPassesThrough(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/artifact-installations" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": ebcontract.ArtifactInstallationList{
			Artifacts: []ebcontract.ArtifactInstallation{{
				Artifact: ebcontract.ReleaseArtifactIdentity{Kind: ebcontract.ReleaseArtifactKindTool, ID: "context7"},
				Version:  "0.1.0",
			}},
		}})
	}))
	defer server.Close()

	svc, err := newService(configuredTestStore(t, server.URL), testClientRelease(), nil)
	if err != nil {
		t.Fatalf("newService() error = %v", err)
	}
	svc.setConnectionState(runtimeBootstrap{EucliBoxReachable: true})
	list, err := svc.listArtifactInstallations(context.Background())
	if err != nil {
		t.Fatalf("listArtifactInstallations() error = %v", err)
	}
	if len(list.Artifacts) != 1 || list.Artifacts[0].Version != "0.1.0" {
		t.Fatalf("list = %#v", list)
	}
}

func TestReleaseCandidateReadsFailClearly(t *testing.T) {
	svc, err := newService(configuredTestStore(t, "http://127.0.0.1:1"), testClientRelease(), nil)
	if err != nil {
		t.Fatalf("newService() error = %v", err)
	}
	if _, err := svc.listReleaseCandidates(context.Background(), "unknown"); err == nil {
		t.Fatal("unknown kind error = nil")
	}
	_, err = svc.listReleaseCandidates(context.Background(), "tool")
	var coded codedError
	if !errors.As(err, &coded) || coded.Code() != "EUCLI_BOX_CONNECTION_REQUIRED" {
		t.Fatalf("disconnected error = %#v", err)
	}
	if _, err := svc.listArtifactInstallations(context.Background()); !errors.As(err, &coded) || coded.Code() != "EUCLI_BOX_CONNECTION_REQUIRED" {
		t.Fatalf("installations disconnected error = %#v", err)
	}
}

func TestReleaseCandidateRejectsInvalidSource(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"data": ebcontract.ArtifactCandidateList{SourceKind: "bogus", Candidates: []ebcontract.ArtifactReleaseCandidate{}}})
	}))
	defer server.Close()
	svc, err := newService(configuredTestStore(t, server.URL), testClientRelease(), nil)
	if err != nil {
		t.Fatalf("newService() error = %v", err)
	}
	svc.setConnectionState(runtimeBootstrap{EucliBoxReachable: true})
	if _, err := svc.listReleaseCandidates(context.Background(), "tool"); err == nil {
		t.Fatal("invalid source error = nil")
	}
}

func configuredTestStore(t *testing.T, url string) *configStore {
	t.Helper()
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.saveConnection(url, "", false); err != nil {
		t.Fatalf("save config error = %v", err)
	}
	return store
}
