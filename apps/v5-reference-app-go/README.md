# v5-reference-app-go

Go sidecar 版本的 Fast Window v5 App 模范实现。

这个 App 的目标不是提供业务功能，而是作为所有 v5 registered app 的可运行标准样板。新 App 可以复制本目录，再替换命名、图标、业务 UI 和业务 sidecar。

## 包含的标准能力

- 独立 Tauri v2 App 壳。
- Go sidecar 独立 exe，Rust 壳负责启动和停止。
- FW control：`127.0.0.1:0`、随机 token、`fw-app-control-ready`、`POST /control`。
- App 单实例：`127.0.0.1:0`、随机 token、状态文件、响应身份校验。
- 单实例状态按 Tauri desktop identifier 隔离，dev/release 不串实例。
- FW 模式和 standalone 模式分离。
- standalone 托盘：显示窗口、退出。
- unified shutdown：上报窗口边界、停止 sidecar、清理单实例状态、退出主进程。
- 自绘顶部栏，空白区域手动 `startDragging()`。
- 数据目录指针与业务数据分离。
- sidecar 启动前检查业务数据目录可写。
- Go 侧 `schemaVersion`、`dataVersion`、`_migrations.json`、`_meta.json` 骨架。
- 前端加载态、错误态、数据目录选择、运行中 command 接收演示。
- 标准构建脚本：`build:backend`、`build:resources`、`build:ui`、`build:exe:dev`、`build:exe`。

## 复制成新 App 时必须替换

| 项 | 当前值 | 新 App 替换建议 |
|---|---|---|
| 目录名 | `v5-reference-app-go` | `your-app-id` |
| package name | `@fast-window/app-v5-reference-app-go` | `@fast-window/app-your-app-id` |
| Tauri package | `v5-reference-app-go` | `your-app-id-app` 或 `your-app-id` |
| productName | `v5 Reference App Go` | 产品名 |
| release identifier | `com.fastwindow.v5referenceappgo` | `com.fastwindow.<app>` |
| dev identifier | `com.fastwindow.v5referenceappgo.dev` | `com.fastwindow.<app>.dev` |
| Rust app id | `v5-reference-app-go` | 注册 App ID |
| sidecar exe | `v5-reference-app-go-backend` | `<app-id>-backend` |
| settings file | `v5-reference-app-go-settings.json` | `<app-id>-settings.json` |
| Vite port | `1434` | 未占用端口 |
| commands | `open-reference`、`show-health`、`edit-settings` | App 自己的命令 |

## 复制后保留不变的机制

- control server 协议字段。
- single-instance 动态端口和状态文件结构。
- token 生成方式。
- shutdown 顺序。
- `build:ui` 作为所有构建入口的前置步骤。
- 数据目录可写检测。
- migration runner 和 ledger 概念。
- 顶部栏手动拖拽策略。

## 验收命令

```powershell
pnpm --dir apps/v5-reference-app-go build:backend
go test ./...
pnpm --dir apps/v5-reference-app-go build:ui
cargo check --manifest-path apps/v5-reference-app-go/src-tauri/Cargo.toml
pnpm --dir apps/v5-reference-app-go build:exe:dev
```

`go test ./...` 需要在 `apps/v5-reference-app-go/backend-go` 目录执行，或使用等价的 `go test ./apps/v5-reference-app-go/backend-go/...` 风格命令。

## 手工验收清单

- standalone 启动时显示任务栏和托盘。
- standalone 关闭按钮隐藏到托盘，不退出主进程。
- 托盘“显示窗口”可唤醒窗口。
- 托盘“退出”停止 Go sidecar 并退出主进程。
- FW 启动时不显示托盘和 standalone 窗口控制按钮。
- FW `show` 显示并聚焦。
- FW `hide` 隐藏窗口。
- FW `toggle` 显示/隐藏切换。
- FW `close` 走统一 shutdown。
- 重复启动不会产生第二个主实例。
- dev/release 可各自独立运行，不互相转发。
- 数据目录不可写时前端显示错误态。
- 切换数据目录后 sidecar 重启并连接新目录。
- 移动/缩放窗口后 stdout 上报 `fw-app-window-bounds`。

## 不应加入模范 App 的内容

- 业务 UI。
- 真实业务 RPC。
- 插件时代的 `window.fastWindow`。
- 插件时代的 `background.endpoint`。
- 固定 control 端口。
- 时间戳或 pid 拼接 token。
- 长期运行时读取旧插件目录的 fallback。
