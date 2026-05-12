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
- 数据迁移失败时保留 `_migration-recovery` 恢复包，不提供覆盖式重置入口。

## 业务能力

- 列出收藏文件夹。
- 添加、编辑、删除收藏文件夹。
- 打开收藏文件夹。
- 搜索和分组筛选。
- 设置入口、数据目录选择、后台重试。

## 数据与迁移

业务数据存放在用户选择的数据目录中，当前主文件为 `data.json`。后端启动时先执行迁移，再读取业务数据；只有全新目录缺少 `data.json` 时才会创建默认空数据。

数据目录中的标准文件：

- `data.json`：收藏数据主文件，当前 `schemaVersion` 为 `1`，`dataVersion` 为 `5`。
- `_meta.json`：当前后端支持的数据版本元信息。
- `_migrations.json`：已成功执行的迁移账本。
- `_migration-recovery/`：每次迁移前生成的恢复包目录。

迁移原则：

- `dataVersion` 低于当前版本时，按注册迁移显式升级。
- `dataVersion` 高于当前支持版本时直接失败，避免旧程序误写新数据。
- `dataVersion` 缺失时直接失败，除非 `_meta.json` 能明确给出版本。
- 迁移账本只记录成功完成的迁移；如果账本和真实数据版本不一致，启动会直接失败。
- 迁移前会复制受影响文件到 `_migration-recovery/<时间戳>-<迁移ID>/files`，并写入 `plan.json` 描述恢复步骤。
- 不使用“重置为空数据”掩盖迁移失败；失败时保留原始错误和恢复包路径，用于定位真实问题。

当前内置迁移：

- `2026-05-12-folders-data-v1-to-v5`
- `2026-05-12-folders-data-v2-to-v5`
- `2026-05-12-folders-data-v3-to-v5`
- `2026-05-12-folders-data-v4-to-v5`

这些迁移会把旧版单工作区数据转换为当前 `folder`、`url`、`file` 三个分类工作区：旧收藏保留在 `folder` 分类，`url` 和 `file` 分类初始化为空工作区。

## 构建验证

```powershell
go test ./...
pnpm --dir apps/folders build:backend
pnpm --dir apps/folders build:ui
cargo check --manifest-path apps/folders/src-tauri/Cargo.toml
```

`go test ./...` 需要在 `apps/folders/backend-go` 目录执行。
