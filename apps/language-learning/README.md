# language-learning

语言学习的 Fast Window v5 App（Go sidecar 架构）。当前为应用骨架：运行壳、后台通路与设置页占位已就绪，业务能力待设计后接入。

## 架构

- Tauri v2 App 壳（Rust）：双启动模式（独立启动 / FW 宿主启动）、独立托盘、宿主控制入口、单实例保护、统一退出、窗口策略与数据目录管理。
- Go sidecar：本机 WebSocket 随机端口 RPC（`languageLearning.*`），负责数据目录骨架、迁移账本与设置持久化。
- React 前端：自绘顶部栏、设置页占位（概览 / 数据 / 后台 / 示例设置 / 自绘组件）。

数据目录指针存于应用配置目录的 `language-learning-settings.json`；业务数据存于数据目录（默认在应用容器同级 `data/`）。

## 常用命令

```powershell
pnpm --dir apps/language-learning build:backend      # 构建 Go sidecar
pnpm --dir apps/language-learning build:ui           # backend + vite + resources
pnpm --dir apps/language-learning build:exe:dev      # dev exe
pnpm --dir apps/language-learning build:app:dev      # dev staging 容器
pnpm --dir apps/language-learning build:app          # release staging 容器
pnpm --dir apps/language-learning apps:version:check # 版本一致性
```

## 验收

```powershell
go test ./...            # 在 apps/language-learning/backend-go 下执行
cargo test --manifest-path apps/language-learning/src-tauri/Cargo.toml
pnpm --dir apps/language-learning exec tsc --noEmit
pnpm --dir apps/language-learning build:ui
pnpm --dir apps/language-learning build:app:dev
```

手动验收要点：

- 独立启动显示窗口与托盘；关闭按钮隐藏到托盘；托盘可唤回窗口、可退出。
- FW 宿主启动不显示托盘，按宿主指令显示 / 隐藏 / 关闭。
- 重复启动不产生第二个主实例，dev 与 release 互不干扰。
- 数据目录不可写时前端显示错误态；切换数据目录后后台在新目录重启。
- 后台被结束后前端可重新连接并取到新 endpoint。
