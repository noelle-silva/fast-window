# Task Manager

Fast Window v5 任务记录与管理应用。

## 功能根系

- 主页用方形卡片表示任务分组。
- 点击卡片打开任务浮窗，一行一个任务条目。
- 顶部栏加号创建任务分组。
- 任务浮窗右上角加号创建任务。
- 创建弹窗支持按钮保存和 Ctrl+S 保存。
- 任务浮窗支持直接 Ctrl+V 粘贴文本新建任务条目。

## 技术边界

- 任务数据暂存于浏览器 localStorage。
- Rust 侧只保留 Fast Window 独立 app 的窗口、托盘、单实例和控制命令根系。
- 当前功能不需要 sidecar 后台进程，因此构建链路不包含 Go 后台。

## 常用命令

- `pnpm build:ui`
- `pnpm exec tsc --noEmit`
- `cargo check --manifest-path src-tauri/Cargo.toml`
