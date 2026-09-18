# Fast Window

一个基于 **Tauri v2 + React + Vite** 的桌面宿主平台：管理并联动多个 v5 应用（桌面类 / 服务类），兼容旧版插件运行。

## 环境要求

- Node.js（建议 18+）
- pnpm（项目声明：`pnpm@10`）
- Rust stable + Cargo
- Windows 开发：需要 MSVC 工具链（Visual Studio Build Tools）
- Tauri v2 相关依赖：由 `@tauri-apps/cli` 驱动（通过脚本调用）

## 安装

面向使用者安装：请直接从 Release 下载并运行安装包/可执行文件：

- [Releases](https://github.com/noelle-silva/fast-window/releases)

如需本地开发，请看下面的「开发」。

## 开发

安装依赖：

```bash
pnpm install
```

仅前端（浏览器预览）：

```bash
pnpm dev
```

桌面端（Tauri Dev，推荐）：

```bash
pnpm tauri dev
```

说明：

- `pnpm tauri build ...` 会构建宿主本体（不再随包预置任何插件）。
- Tauri 配置在 `src-tauri/tauri.conf.json`。
- 当前 `tauri.conf.json` 的 `beforeDevCommand/beforeBuildCommand` 配置为 `npm run dev/build`（确保你的环境里有 `npm`，或自行改成 `pnpm run ...`）。

## 窗口快捷键行为

唤醒窗口快捷键遵循“先找回，再收起”的窗口模式交互。

主窗口行为：

- 主窗口未出现时，按一次快捷键会显示并聚焦主窗口。
- 主窗口已经出现但被其他窗口挡住、或当前没有获得焦点时，按一次快捷键只会把主窗口聚焦到前面。
- 主窗口已经出现且处于焦点状态时，再按一次快捷键才会隐藏主窗口。

注册 App 的窗口模式行为：

- 注册 App 未运行且快捷键允许启动应用时，按一次快捷键会启动并显示窗口。
- 注册 App 已运行但窗口不在前台时，按一次快捷键会优先把窗口找回到前台。
- 注册 App 已运行且窗口已经在前台时，再按一次快捷键才会隐藏窗口。
- 注册 App 设置为“只控制已运行应用”时，未运行状态下按快捷键不会启动新窗口。

这样可以避免窗口明明在桌面上、却因为被其他窗口遮住而被快捷键误隐藏。若当前环境无法可靠确认窗口是否在前台，会沿用原来的切换方式，避免误判。

构建 Windows 安装包（MSI）：

```bash
pnpm tauri build -b msi
```

## 构建发布

仅构建前端产物：

```bash
pnpm build
```

本地预览构建产物：

```bash
pnpm preview
```

构建桌面安装包/可执行文件（Tauri Build）：

```bash
pnpm tauri build
```

## 插件源码（保留参考）

旧版插件的构建、监听与发布工具链已退役；`plugins/` 源码保留作为参考。插件通过宿主本地导入（zip/文件）安装后由宿主加载运行。

当前包含：

- `ai-draw`：AI 绘图
- `ai-once`：AI 一次性响应
- `anime-finder`：以图找番（trace.moe）
- `bookmarks`：网站收藏
- `calculator`：计算器
- `clipboard-history`：剪贴板历史
- `folders`：收藏集
- `memo`：快捷备忘录
- `vscode-workspaces`：VSCode 工作区（收藏目录，一键用 VSCode 打开）
- `web-view`：Web View（新窗口打开网页）

## 插件契约

- 插件契约/Manifest/能力声明：见 `docs/plugins.md`
- 插件源码：`plugins/<pluginId>/`

## v5 App 开发

应用采用协议体系自治开发（应用内协议目录 + 内部构建链），平台统一调度与发布：

- 协议体系总览：`.fast-window-dev-protocol/README.md`
- 新应用接入指引：`.fast-window-dev-protocol/app-template/README.md`
- 标准样板与命令说明：`apps/v5-reference-app-go/README.md`
- 完整本地可注册目录：`apps/<app-id>/dist-app/v5-windows/`
- 本地完整生成：`pnpm --dir apps/<app-id> build:app` / `pnpm --dir apps/<app-id> build:app:dev`
- 只替换已存在注册目录里的入口 exe：`pnpm --dir apps/<app-id> build:app:exe` / `build:app:exe:dev`
- 中央调度应用动作：`node .fast-window-dev-protocol/fast-window-dev-tool.mjs <app-id> <动作>`
- 发布（应用产出成品，中央执行发布）：`node .fast-window-dev-protocol/fast-window-dev-tool.mjs <app-id> package release`

### 宿主快捷命令与 App 能力 API

v5 App 在宿主里分成两类可见按钮：

- 宿主快捷命令：用于打开应用内页面或动作，来自应用运行时声明，在应用注册页读取和登记。
- App 能力 API：用于被宿主或 Quick Bar 调用，来自应用运行时声明，在能力登记簿里选取和配置。

这两类按钮会一起出现在主页搜索列表里，但保存位置、读取通道和右键操作彼此独立。宿主快捷命令不会进入能力登记簿，App 能力 API 也不会写回应用注册档案。
