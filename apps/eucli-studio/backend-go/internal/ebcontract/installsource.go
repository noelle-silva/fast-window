package ebcontract

// InstallSourceKind 是 eucli-box 发布物安装来源标识。
// official 是官方发行保留字；其余非空值是用户注册的货架名字。
type InstallSourceKind string

const (
	KindOfficial InstallSourceKind = "official"
)
