# command-runner

以仓库为单位管理和一键运行命令行命令的 Fast Window v5 App（Go sidecar 架构）。

## 功能

- **仓库管理**：注册本地仓库目录（支持系统目录选择对话框），支持重命名、更换路径、删除。
- **命令管理**：以仓库为维度维护命令，每条命令拥有独立配置：
  - 命令脚本（支持多行）。
  - 备注说明。
  - 运行前二次确认开关。
  - 窗口关闭策略：执行完保留窗口 / 倒计时自动关闭（秒数可配）/ 立即关闭。
  - 终端指定（可留空继承）。
- **命令行终端**：
  - 自动探测本机常用终端：`cmd`、`powershell`、`pwsh`、`git-bash`、`wsl`。
  - 支持浏览选择本机任意 `.exe` 登记为自定义终端（参数模板使用 `{command}` 占位）。
  - 三级继承：命令级 > 仓库级 > 全局默认。
- **运行机制**：点击运行后由 Go 后端在仓库工作目录下拉起**独立命令行窗口**执行，不在 App 内嵌输出。

## 架构

- Tauri v2 App 壳（Rust），Go sidecar 通过本地 WebSocket 提供 RPC（`commandRunner.*`）。
- 命令执行统一由外层 `wrapper.cmd` 串联：`cmd /c|/k` + 环境变量传路径（规避编码与元字符问题），关闭策略全部由外层统一实现。
- 脚本按终端类型落盘为 `.cmd` / `.ps1`（UTF-8 BOM）/ `.sh`（LF），执行完自动清理。

## 常用命令

```powershell
pnpm --dir apps/command-runner build:backend      # 构建 Go sidecar
pnpm --dir apps/command-runner build:ui           # backend + vite + resources
pnpm --dir apps/command-runner build:exe:dev      # dev exe
pnpm --dir apps/command-runner build:app:dev      # dev staging 容器
pnpm --dir apps/command-runner build:app          # release staging 容器
pnpm --dir apps/command-runner apps:version:check # 版本一致性
```

## 验收

```powershell
go test ./...            # 在 apps/command-runner/backend-go 下执行
cargo test --manifest-path apps/command-runner/src-tauri/Cargo.toml
pnpm --dir apps/command-runner exec tsc --noEmit
pnpm --dir apps/command-runner build:ui
pnpm --dir apps/command-runner build:app:dev
```

手动验收要点：

- 注册仓库 → 新建命令 → 一键运行，独立窗口在仓库目录下执行。
- 三种关闭策略均按预期生效（保留 / 倒计时 / 立即）。
- 二次确认弹窗内容正确，取消不执行。
- 终端三级继承解析正确，不可用终端在选择器中禁用。
- 自定义终端可添加 / 移除，可参与继承链。
