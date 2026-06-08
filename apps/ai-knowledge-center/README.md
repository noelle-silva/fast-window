# AI 知识中心

AI 知识中心是 Fast Window v5 桌面客户端，用来连接本地知识中心服务器，并在桌面端展示资料、搜索结果、资料详情和收藏夹。

## 当前职责

| 区域 | 职责 |
| --- | --- |
| 桌面壳 | 保留窗口、托盘、单实例、平台唤起和统一退出能力 |
| 本机小后台 | 保存服务器地址与访问钥匙，并代替界面向知识中心服务器取内容 |
| 前台界面 | 配置连接、查看健康状态、筛选资料、阅读资料详情、查看收藏夹 |
| 知识中心服务器 | 继续作为资料、搜索、归档、回收站、收藏夹和索引的统一办事入口 |

## 本地配置

客户端自己的连接配置保存在客户端数据目录内。

| 文件 | 内容 |
| --- | --- |
| `connection.json` | 服务器地址等普通连接配置 |
| `secrets.json` | 访问钥匙等敏感配置 |

访问钥匙不会在界面中回显。保存连接时，如果访问钥匙输入框留空，客户端会继续使用已经保存的访问钥匙。

## 默认服务器

默认服务器地址为：

```txt
http://127.0.0.1:17321
```

该地址对应知识中心服务器示例配置。实际使用时，可以在连接设置页替换为自己的服务器地址。

## 支持的展示能力

| 能力 | 状态 |
| --- | --- |
| 健康检查 | 已接入 |
| 资料列表 | 已接入 |
| 状态筛选 | 已接入 |
| 关键词搜索 | 已接入 |
| 标签筛选 | 已接入 |
| 资料详情 | 已接入 |
| 收藏夹嵌套展示 | 已接入 |

## 身份信息

| 项目 | 当前值 |
| --- | --- |
| App ID | `ai-knowledge-center` |
| package name | `@fast-window/app-ai-knowledge-center` |
| Tauri identifier | `com.fastwindow.aiknowledgecenter` |
| Dev identifier | `com.fastwindow.aiknowledgecenter.dev` |
| Sidecar | `ai-knowledge-center-backend` |
| Vite port | `1439` |

## 验收命令

```powershell
pnpm --dir apps/ai-knowledge-center build:backend
go test ./...
pnpm --dir apps/ai-knowledge-center exec tsc --noEmit
pnpm --dir apps/ai-knowledge-center exec vite build
cargo check --manifest-path apps/ai-knowledge-center/src-tauri/Cargo.toml
```

`go test ./...` 需要在 `apps/ai-knowledge-center/backend-go` 目录执行。

## 根系说明

客户端没有绕开知识中心服务器直接读写资料目录。资料、收藏夹、状态和搜索仍由服务器统一处理；客户端只保存连接信息并展示服务器返回的结果。
