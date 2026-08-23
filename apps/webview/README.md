# webview

webview 是 Fast Window v5 应用体系中的**独立网页收藏与浏览 App**：维护网站书签，点击书签后以内嵌「浏览栈」打开网页，并内置网页视频倍速能力。

本 App 基于 `v5-reference-app-go` 模板派生（保留模板壳机制：单实例、托盘、FW 控制端口、Go sidecar 骨架），并按仓库中 Quick Bar 确立的「Rust 后端归位」思路实现自有业务：书签数据、图标、网页浏览与视频倍速全部由 Rust 壳命令 + 前端页面完成，宿主与 web-view 插件本身不做任何修改。

## 功能

- **书签管理**：新增、编辑、删除、搜索、右键菜单（打开/编辑/刷新图标/删除）、拖拽排序。
- **图标嗅探与本地化**：自动嗅探网站图标并下载为本地 PNG（离线可用），支持手动刷新与清除。
- **内嵌浏览栈**：点击书签打开"顶部栏 + 网页内容"双窗口浏览器，支持关闭（销毁）、隐藏、全屏、图钉置顶、后退/前进/刷新，位置记忆，失焦自动收起，Windows 底部圆角。
- **网页视频倍速**：默认倍速 + 最大倍速 + 预设（可绑定快捷键，网页内按快捷键切换/还原），顶部栏速度菜单可循环切换。
- **无宿主网页数据迁移**：书签数据独立存储，不做任何旧数据迁移。

## 窗口结构

| 窗口 | label | 职责 |
|---|---|---|
| 主窗口 | `main` | 书签页（含顶部 chrome 与倍速设置页） |
| 浏览栈顶部栏 | `browser_bar` | 浏览按钮条与速度菜单 |
| 浏览栈内容 | `browser` | 加载外部网页 |

## 数据与配置

数据目录由 App 运行位置自动计算（`package/` 同级 `data/`；exe 不在 `package/` 时用 exe 同目录 `data/`）：

- `bookmarks.json`：书签列表（结构：id/title/url/iconUrl/iconPath/createdAt/updatedAt）
- `bookmark-icons/`：本地化图标文件（PNG/JPG/WebP/GIF）
- `app.json`：应用配置（`webview` 视频倍速设置、`browserWindowBounds` 浏览栈位置记忆）
- `webview-settings.json`：用户自选数据目录（App 配置目录内）

Go sidecar 骨架仍由模板机制接管（`settings.json`、`_meta.json`、`_migrations.json` 由其负责），但书签与浏览业务不经过 sidecar。

## 平台命令

| 命令 | 用途 |
|---|---|
| `open-webview` | 打开主窗口书签主页 |
| `open-settings` | 打开主窗口并进入倍速设置 |
| `show-health` | 打开主窗口（Go 骨架健康状态） |

## 开发命令

```powershell
pnpm --dir apps/webview build:backend
pnpm --dir apps/webview apps:version:check
pnpm --dir apps/webview apps:bump:dry
go test ./...   # 需在 apps/webview/backend-go 目录执行
pnpm --dir apps/webview exec tsc --noEmit
cargo check --manifest-path apps/webview/src-tauri/Cargo.toml
pnpm --dir apps/webview exec vite build
pnpm --dir apps/webview build:exe:dev
```

## 构建命令

```powershell
pnpm --dir apps/webview build:app:dev
pnpm --dir apps/webview build:app
```

`build:app:dev` 用于生成本地开发版应用容器（`apps/webview/dist-app/v5-windows-dev/`），`build:app` 用于生成本地正式版容器（`apps/webview/dist-app/v5-windows/`）。

## 手工验收清单

- 独立启动显示主窗口与托盘；关闭按钮隐藏到托盘。
- 书签页：搜索、新增、编辑、删除、右键菜单、拖拽排序、空态引导均可用。
- 新增书签后自动打开浏览栈；图标自动嗅探并下载到本地，离线仍显示。
- 浏览栈：顶部栏关闭/隐藏/全屏/图钉/后退/前进/刷新可用；移动记忆位置；失焦自动收起（图钉后不收起）。
- 视频倍速：设置页配置默认/最大倍速与预设快捷键；网页内快捷键切换/还原；顶部栏速度菜单循环切换生效。
- 数据目录不可写时主窗口显示错误状态（Go 骨架机制）。
- FW 启动行为（show/hide/toggle/close、bounds 上报、命令分发 open-webview/open-settings/show-health）与 v5 模板一致。
- 重复启动转发到已有实例；dev/release 互不串实例。

## 与模板的关系

- 派生自 `apps/v5-reference-app-go`（v5 Go sidecar 模板），模板壳模块（single_instance / fw_window / control_server / standalone_tray / data_dir / shutdown / backend_lifecycle / backend_sidecar）保留，仅做身份替换。
- 新增模块：`browser_stack.rs`（浏览栈状态机）、`browser_commands.rs`（浏览与世界命令组 + 视频倍速）、`bookmarks.rs`（书签与图标命令）、`http_gateway.rs`（HTTP 网关）、`app_config.rs`（应用配置）。
- 前端新增：`BookmarksPage.tsx`（书签页）、`BrowserBarApp.tsx`（浏览栈顶部栏）、`WebviewSettingsPage.tsx`（倍速设置页）。
- 宿主（`src/`、`src-tauri/`）与插件（`plugins/web-view/`）零改动。
