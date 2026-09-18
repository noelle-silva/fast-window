// Package ebcontract 是 eucli-studio 客户端自有的 eucli-box 发行协议契约：
// 承载客户端消费的 eucli-box 发布/已装事实类型与版本兼容规则，客户端独立维护。
package ebcontract

import "time"

type EucliBoxCompatibility struct {
	MinimumVersion          string `json:"minimumVersion"`
	MaximumVersionExclusive string `json:"maximumVersionExclusive"`
}

type CompatibilityStatus struct {
	Compatible                    bool                  `json:"compatible"`
	Reason                        string                `json:"reason,omitempty"`
	CurrentEucliBoxVersion        string                `json:"currentEucliBoxVersion,omitempty"`
	RequiredEucliBoxCompatibility EucliBoxCompatibility `json:"requiredEucliBoxCompatibility"`
}

type EucliBoxReleaseInfo struct {
	Version             string               `json:"version"`
	DataVersion         string               `json:"dataVersion"`
	ClientCompatibility *CompatibilityStatus `json:"clientCompatibility,omitempty"`
}

const (
	ReleaseArtifactKindTool   = "tool"
	ReleaseArtifactKindPlugin = "plugin"

	ReleaseCandidateStatusCompleted = "completed"
)

type ReleaseArtifactIdentity struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

type OfficialReleaseSource struct {
	Kind       string `json:"kind"`
	Repository string `json:"repository"`
	Owner      string `json:"owner"`
	Name       string `json:"name"`
	Ref        string `json:"ref,omitempty"`
}

// ArtifactInstallation 是业务端当前真实的已装事实：某个发布物装了、装的是哪个版本、适用什么范围。
// FailureReason 只在读取该分类已装事实失败时出现，此时身份是分类本身。
type ArtifactInstallation struct {
	Artifact      ReleaseArtifactIdentity `json:"artifact"`
	Version       string                  `json:"version"`
	Compatibility *EucliBoxCompatibility  `json:"eucliBoxCompatibility,omitempty"`
	FailureReason string                  `json:"failureReason,omitempty"`
}

// ArtifactInstallationList 是已装事实的完整清单。
type ArtifactInstallationList struct {
	Artifacts []ArtifactInstallation `json:"artifacts"`
}

// ArtifactReleaseCandidate 是某个发布物在某个来源下的可用候选事实，
// 以及它与已装事实比对后的结论；不携带任何快照状态。
type ArtifactReleaseCandidate struct {
	Artifact          ReleaseArtifactIdentity   `json:"artifact"`
	Source            OfficialReleaseSource     `json:"source"`
	Installed         bool                      `json:"installed"`
	CurrentVersion    string                    `json:"currentVersion,omitempty"`
	LatestVersion     string                    `json:"latestVersion,omitempty"`
	Status            string                    `json:"status"`
	PublishedAt       time.Time                 `json:"publishedAt,omitempty"`
	UpdateAvailable   bool                      `json:"updateAvailable"`
	ReleaseURL        string                    `json:"releaseUrl,omitempty"`
	ReleaseNotes      string                    `json:"releaseNotes,omitempty"`
	DownloadSize      int64                     `json:"downloadSize,omitempty"`
	Compatibility     *CompatibilityStatus      `json:"compatibility,omitempty"`
	AffectedArtifacts []ReleaseArtifactIdentity `json:"affectedArtifacts,omitempty"`
	FailureReason     string                    `json:"failureReason,omitempty"`
}

// ArtifactCandidateList 是某个分类在某个来源下的候选完整清单：
// 来源种类（official/local）+ 该分类全部可展示项。
type ArtifactCandidateList struct {
	SourceKind string                     `json:"source"`
	Candidates []ArtifactReleaseCandidate `json:"candidates"`
}
