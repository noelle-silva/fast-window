# cf-adapter（fast-window 宿主契约 3 适配器）

为 `fast-window` 宿主实现 `eucli-code-factory` 契约 3（`.dev-tools/adapter.toml`）所需的 7 条命令：

- `deps`：使用本空间 `EUCLI_CF_DEPS_STORE/npm` 缓存按 `package-lock.json` 执行 `npm ci`。
- `build`：构建前端（`npm run build`）并以 `CARGO_TARGET_DIR=${EUCLI_CF_BUILD_DIR}/cargo-target` 构建 release 宿主程序至 `EUCLI_CF_BUILD_DIR/fast-window.exe`，结束后清理工作树临时构建产物。
- `start`：校验注入的实例身份后缀与数据根，拉起隔离宿主实例（独立数据根、独立 WebView2 目录，不注册系统托盘、不抢占全局热键、不改写开机自启注册表）。
- `health`：检查隔离实例进程存活及 `EUCLI_CF_DATA_ROOT/host-ready.json` 就绪标记。
- `stop`：幂等终止隔离宿主进程树。
- `seed`：宿主启动即完成数据迁移与初始化，无需外部预置基线，按契约返回 `not-applicable`。
- `test`：核验运行中的隔离宿主就绪，随后运行中央协议全套测试、宿主构建策略测试、中央注册表全量体检（`--list`）以及 Rust 宿主单元测试。
