# fast-window-dev-protocol

应用开发协议体系：应用自治开发，中央统一调度与发布。

## 目录地图

```text
.fast-window-dev-protocol/
├── fast-window-dev-tool.mjs            中央调度工具
├── fast-window-dev-receipt-contract.md 回执契约（双方唯一沟通依据）
├── modules/                            平台能力模块（发布、校验等）
├── app-template/                       应用工具模板（复制进应用即用）
├── tests/                              中央工具测试
└── .env                                发布凭据（仅中央持有，gitignore）
```

## 使用方式

```text
node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用id> <动作代号> [release]
```

- 调度工具读取应用的协议字典，用声明的 runner 启动应用自己的工具执行动作。
- 应用工具按回执契约输出结果；中央解析回执并报告成败。
- 第三参数为 `release` 时，中央会用回执中的成品执行发布：上传 GitHub Release、写回商店目录。

## 角色边界

- **应用**：构建、装配、打包（商店化产出成品）；不持有发布逻辑与凭据。
- **中央**：调度应用动作；`release` 模式唯一发布；凭据只读本目录 `.env`。

## 关联文档

- 回执契约：`fast-window-dev-receipt-contract.md`
- 接入指引（新应用）：`app-template/README.md`
- 体系语义：`.dev-management/doc-source/platform/app-protocol-system-semantics.md`
