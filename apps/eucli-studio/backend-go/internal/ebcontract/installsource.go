package ebcontract

// InstallSourceKind 是 eucli-box 发布物安装来源类别。
// official 读取固定官方发行；local 读取本地商店货架。
type InstallSourceKind string

const (
	KindOfficial InstallSourceKind = "official"
	KindLocal    InstallSourceKind = "local"
)
