# fast-window-dev-protocol

应用开发协议体系：应用自治开发，中央统一调度与发布。

## 目录地图

```text
.fast-window-dev-protocol/
├── fast-window-dev-tool.mjs            中央调度工具
├── fast-window-dev-receipt-contract.md 回执契约（双方唯一沟通依据）
├── modules/                            平台能力模块（发布、校验、下架等）
├── app-template/                       应用工具模板（复制进应用即用）
├── tests/                              中央工具测试
└── .env                                发布凭据（仅中央持有，gitignore）
```

## 使用方式

```text
node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用id> <动作代号> [release]
node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用id> --verify [--zip <成品包>] [--catalog <本地目录文件>]
node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用id> --unpublish [--dry-run]
```

- 调度工具读取应用的协议字典，用声明的 runner 启动应用自己的工具执行动作。
- 应用工具按回执契约输出结果；中央解析回执并报告成败。
- 第三参数为 `release` 时，中央会用回执中的成品执行发布：上传 GitHub Release、写回商店目录。
- 中央管理动作不经过应用工具：
  - `--verify`：对应用成品商店包做离线完整校验（包结构、清单、图标、程序、版本、摘要），可选用本地商店目录文件比对条目；未指定 `--zip` 时默认取协议目录产出区里最新修改的成品。
  - `--unpublish`：从远程商店目录移除该应用条目；`--dry-run` 只预演不写远程。

## 角色边界

- **应用**：构建、装配、打包（商店化产出成品）；不持有发布逻辑与凭据。
- **中央**：调度应用动作；`release` 模式唯一发布；校验与下架等商店管理动作只由中央执行；凭据只读本目录 `.env`。

## 验证

```text
node --test .fast-window-dev-protocol/tests/fast-window-dev-tool.test.mjs .fast-window-dev-protocol/tests/packaging-guards.test.mjs .fast-window-dev-protocol/tests/store-ops.test.mjs
```

## 关联文档

- 回执契约：`fast-window-dev-receipt-contract.md`
- 接入指引（新应用）：`app-template/README.md`
- 体系语义：`.dev-management/doc-source/platform/app-protocol-system-semantics.md`
