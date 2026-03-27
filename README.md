# Fast Window

一个基于 **Tauri v2 + React + Vite** 的桌面小工具宿主，支持通过 `plugins/` 目录加载/打包内置插件。

## 插件商店（GitHub 分发）

插件分发仓库（只放 `index.json` + Release assets）：

- https://github.com/noelle-silva/fast-window-plugins-download

插件发布页（下载 ZIP 的地方）：

- https://github.com/noelle-silva/fast-window-plugins-download/releases

商店索引（宿主默认内置的 index 地址）：

- https://raw.githubusercontent.com/noelle-silva/fast-window-plugins-download/main/index.json

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

- `pnpm tauri dev` 会自动启动 `pnpm plugins:watch`：插件源码改动会自动打包输出到 `manifest.main` 指向的单文件入口（必要时在 App 内点“刷新插件”以重新加载）。
- `pnpm tauri build ...` 会先执行 `pnpm plugins:build`（把可构建插件打包成 `manifest.main` 的单文件入口），再执行 `scripts/prepare-tauri-resources.mjs` 把 `plugins/` 同步到 `src-tauri/plugin-seeds/`，用于打包资源。
- 可选：设置 `FAST_WINDOW_PLUGIN=<pluginId>` 可只构建/监听某一个插件，避免插件很多时启动变慢。
- Tauri 配置在 `src-tauri/tauri.conf.json`。
- 当前 `tauri.conf.json` 的 `beforeDevCommand/beforeBuildCommand` 配置为 `npm run dev/build`（确保你的环境里有 `npm`，或自行改成 `pnpm run ...`）。

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

## 内置插件

仓库内置插件位于 `plugins/`，当前包含：

- `ai-draw`：AI 绘图
- `ai-once`：AI 一次性响应
- `anime-finder`：以图找番（trace.moe）
- `bookmarks`：网站收藏
- `calculator`：计算器
- `clipboard-history`：剪贴板历史
- `folders`：文件夹收藏
- `memo`：快捷备忘录
- `vscode-workspaces`：VSCode 工作区（收藏目录，一键用 VSCode 打开）
- `web-view`：Web View（新窗口打开网页）

## 插件开发

- 插件契约/Manifest/能力声明：见 `docs/plugins.md`
- 插件源码：`plugins/<pluginId>/`
- 插件打包资源：`src-tauri/plugin-seeds/`（由脚本从 `plugins/` 同步生成）
- 插件构建：`pnpm plugins:build` / 开发监听：`pnpm plugins:watch`（可用 `pnpm dev:all` 同时跑监听与前端 dev）
- `pnpm tauri`：已接入 `plugins:build`，确保打包/运行前插件产物是最新

## 发布插件到商店（分发仓库）

要求：准备一个 Fine-grained Token（最小权限：对 `fast-window-plugins-download` 的 Contents/Release 读写），并配置环境变量：

- `FAST_WINDOW_GITHUB_TOKEN=...`（也兼容 `GITHUB_TOKEN` / `GH_TOKEN`）

发布单个插件：

```bash
pnpm run plugins:publish:download -- --plugin <pluginId>
```

发布全部插件（遍历 `plugins/`）：

```bash
pnpm run plugins:publish:download -- --all
```

常用参数：

- `--dry-run`：只生成 zip/index 预览，不 push、不创建 Release
- `--no-build`：跳过插件构建（仅用于已经是单文件入口/预构建插件）
- `--force`：强制覆盖同版本（不推荐）

重要：版本不可变（KISS）。同一个 `pluginId@version` 已发布就禁止覆盖；需要升级请改 `plugins/<pluginId>/manifest.json` 的 `version`。
