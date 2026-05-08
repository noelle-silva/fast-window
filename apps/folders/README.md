# folders

文件夹收藏的 Fast Window v5 App 实现。

## 标准能力

- 独立 Tauri v2 App 壳。
- Go sidecar 独立 exe：`folders-backend.exe`。
- FW control：`127.0.0.1:0`、随机 token、`fw-app-control-ready`、`POST /control`。
- App 单实例：`127.0.0.1:0`、随机 token、状态文件、响应身份校验。
- 单实例状态按 Tauri identifier 隔离，dev/release 不串实例。
- FW 模式和 standalone 模式分离。
- standalone 托盘：显示窗口、退出。
- unified shutdown：上报窗口边界、停止 sidecar、清理单实例状态、退出主进程。
- 自绘顶部栏，空白区域手动 `startDragging()`。
- 数据目录指针与业务数据分离。
- Go 侧 `schemaVersion`、`dataVersion`、`_migrations.json`、`_meta.json`。

## 业务能力

- 列出收藏文件夹。
- 添加、编辑、删除收藏文件夹。
- 打开收藏文件夹。
- 搜索和分组筛选。
- 设置入口、数据目录选择、后台重试。

## 构建验证

```powershell
go test ./...
pnpm --dir apps/folders build:backend
pnpm --dir apps/folders build:ui
cargo check --manifest-path apps/folders/src-tauri/Cargo.toml
```

`go test ./...` 需要在 `apps/folders/backend-go` 目录执行。
