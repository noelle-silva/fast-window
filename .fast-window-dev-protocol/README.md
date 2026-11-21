# fast-window-dev-protocol

应用开发协议体系：应用自治开发，中央统一调度与发布。

## 目录地图

```text
.fast-window-dev-protocol/
├── fast-window-dev-tool.mjs            中央调度工具
├── fast-window-dev-receipt-contract.md 回执契约（双方唯一沟通依据）
├── modules/                            平台能力模块（注册表、派发、发布、校验、下架等）
├── app-template/                       应用工具模板（复制进应用即用）
├── tests/                              中央工具测试
├── app-registry.json                   应用注册表（本机绝对路径，gitignore）
└── .env                                发布凭据（仅中央持有，gitignore）
```

## 应用注册表

中央只按注册表寻址应用：应用名 → 应用根目录绝对路径（其下有 `.fast-window-dev-protocol/`）。应用放在哪里都可以，仓库内外一视同仁，全部都要登记。

- 注册表记录本机路径，不进版本库；换机后逐个重新登记。
- 未登记、登记路径不存在、目录未接入协议（缺协议目录、动作字典或应用工具），一律直接报错。

## 使用方式

```text
node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用id> <动作代号> [release]
node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用id> --verify [--zip <成品包>] [--catalog <本地目录文件>]
node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用id> --unpublish [--dry-run]
node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用id> --register <应用根目录绝对路径>
node .fast-window-dev-protocol/fast-window-dev-tool.mjs --list
node .fast-window-dev-protocol/fast-window-dev-tool.mjs --check-templates
```

- 调度工具按注册表找到应用，读取应用的协议字典，用声明的 runner 启动应用自己的工具执行动作。
- 应用工具按回执契约输出结果；中央解析回执并报告成败。
- 第三参数为 `release` 时，中央会用回执中的成品执行发布：上传 GitHub Release、写回商店目录。
- 注册表管理：
  - `--register`：登记应用；路径必须是绝对路径且已接入协议。同名再登记会改写路径，并打印旧路径 → 新路径。
  - `--list`：列出全部登记及其状态（可用 / 不可用原因）；有不可用条目时退出码非零。
  - `--check-templates`：比对各应用工具与 `app-template/fast-window-dev-tool.mjs` 内容是否一致（一致 / 过期 / 不可用），忽略换行符差异（各仓库按自己的 eol 规则检出）；只检查不同步，有不一致时退出码非零。
- 中央管理动作不经过应用工具：
  - `--verify`：对应用成品商店包做离线完整校验（包结构、清单、图标、程序、版本、摘要），可选用本地商店目录文件比对条目；未指定 `--zip` 时默认取协议目录产出区里最新修改的成品。
  - `--unpublish`：从远程商店目录移除该应用条目；`--dry-run` 只预演不写远程。

## 角色边界

- **应用**：构建、装配、打包（商店化产出成品）；不持有发布逻辑与凭据。
- **中央**：调度应用动作；`release` 模式唯一发布；校验与下架等商店管理动作只由中央执行；凭据只读本目录 `.env`。

## 验证

```text
node --test .fast-window-dev-protocol/tests/app-registry.test.mjs .fast-window-dev-protocol/tests/fast-window-dev-tool.test.mjs .fast-window-dev-protocol/tests/store-catalog.test.mjs .fast-window-dev-protocol/tests/store-ops.test.mjs
```

## 关联文档

- 回执契约：`fast-window-dev-receipt-contract.md`
- 接入指引（新应用）：`app-template/README.md`
- 体系语义：`.dev-management/doc-source/platform/app-protocol-system-semantics.md`
