# Quick Bar

Quick Bar 是 Fast Window v5 应用体系中的划词快捷工具条应用。第一阶段目标是：用户选中文字后，按下 Quick Bar 自己保存和监听的快捷键，在选区附近显示一个轻量浮动工具条，工具条按钮当前只作为占位展示。

## 当前阶段

- 应用 ID：`quick-bar`
- 应用名称：`Quick Bar`
- 当前版本：`0.1.0`
- 当前定位：划词后弹出快捷操作浮动条
- 当前系统支持：Windows 选区读取
- 默认唤醒快捷键：`control+alt+Q`
- 当前按钮：`AI`、`翻译`、`搜索`、`复制`
- 当前按钮行为：仅展示占位，不执行真实动作

## 工作方式

```mermaid
flowchart LR
  A[用户在外部软件选中文字] --> B[按下 Quick Bar 自己保存的快捷键]
  B --> C[Quick Bar 读取当前选区]
  C --> D[计算选区附近位置]
  D --> E[显示浮动工具条]
  E --> F[展示占位按钮]
```

## 快捷键管理

Quick Bar 的浮动条唤醒快捷键由应用自己管理，不需要在 Fast Window 平台里为浮动条额外绑定快捷键。

- 在主窗口的“快捷键”页可以录制并保存唤醒快捷键。
- 应用启动后会自动注册保存的快捷键。
- 快捷键注册失败时，主窗口会显示当前状态和错误信息。
- 快捷键至少需要包含一个修饰键，避免误触普通按键。

## 窗口职责

Quick Bar 保持两个窗口职责分离：

- 主窗口：用于查看应用目标、快捷键状态、数据目录和后台健康状态。
- 浮动条窗口：用于显示当前选中文字和占位快捷按钮。

## 平台命令

平台命令只保留管理入口，不再承担浮动条唤醒职责。

| 命令 | 用途 |
|---|---|
| `open-settings` | 打开主窗口，并进入设置概览。 |
| `show-health` | 打开主窗口，并进入后台健康状态。 |

## 数据与后台

- 应用会保存用户选择的数据目录位置。
- 应用会保存用户录制的唤醒快捷键。
- 默认数据目录由应用运行位置自动计算。
- Go 后台当前只保留本阶段真实需要的健康检查能力。
- 数据目录会写入 `_meta.json` 和 `_migrations.json`，用于保留后续数据演进基础。

## 开发命令

在仓库根目录可执行：

```powershell
pnpm --dir apps/quick-bar build:backend
pnpm --dir apps/quick-bar build:ui
pnpm --dir apps/quick-bar exec tsc --noEmit
cargo check --manifest-path apps/quick-bar/src-tauri/Cargo.toml
```

在 Go 后台目录可执行：

```powershell
go test ./...
```

## 构建命令

```powershell
pnpm --dir apps/quick-bar build:app:dev
pnpm --dir apps/quick-bar build:app
```

`build:app:dev` 用于生成本地开发版应用容器，`build:app` 用于生成本地正式版应用容器。

## 手工验收清单

- 独立启动时显示主窗口和托盘入口。
- 主窗口“快捷键”页可以录制并保存唤醒快捷键。
- 外部选中文字后，按 Quick Bar 保存的快捷键显示浮动工具条。
- 有文本选区时，浮动工具条出现在选区附近。
- 浮动工具条展示选中文字和四个占位按钮。
- 浮动工具条失焦或按 `Esc` 后隐藏。
- 平台触发 `open-settings` 时打开主窗口并显示设置概览。
- 平台触发 `show-health` 时打开主窗口并显示后台健康状态。
- 数据目录不可写时，主窗口显示错误状态。

## 当前不包含

- 不要求在 Fast Window 平台里为浮动条绑定快捷键。
- 不通过剪贴板复制选中文字。
- 不执行真实 AI、翻译、搜索、复制动作。
- 不提供跨平台选区读取实现。
