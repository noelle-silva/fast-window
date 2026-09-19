# 应用工具模板（app-template）

复制本目录两件套到任意应用的协议目录，即可让该应用接入开发协议体系、自治开发。

## 两件套

| 文件 | 作用 |
|---|---|
| `fast-window-dev-tool.mjs` | 应用工具：执行字典命令、按点号路径提取成品、商店化打包、按回执契约输出。零外部依赖，只用 Node 内置模块。 |
| `fast-window-dev-protocol.json` | 动作字典模板：`runner` 固定 `node`，`actions` 按应用改写。 |

## 接入步骤

1. **复制**：把本目录两个文件复制到 `apps/<应用id>/.fast-window-dev-protocol/`（工具保持逐字节一致，不要改）。
2. **清单**：把应用的 `fw-app.json` 放入同一协议目录（身份/展示/运行的唯一事实源）。
3. **收编构建链**：把应用需要的构建能力模块与 CLI 收进应用自己的 `scripts/`，纳入其内部构建链。
4. **注册动作**：修改字典 `actions`，把内部构建注册为协议动作。

   动作两种形态：

   ```json
   {
     "stage-dev": "node ../scripts/stage-app.mjs --profile dev",
     "package": {
       "command": "node ../scripts/package-app.mjs",
       "artifact": { "path": "zipPath", "name": "zipName", "sha256": "sha256" },
       "storePackage": true
     },
     "stage-instance": {
       "command": "node ../scripts/package-app.mjs",
       "artifact": { "path": "zipPath" },
       "storePackage": { "form": "exploded", "outDir": "../.dev-workspace/instance" }
     }
   }
   ```

   - 纯命令字符串：只执行命令。
   - 对象形态：执行命令后按 `artifact` 从命令 JSON 输出提取成品；`storePackage` 为真时自动把成品商店化。
   - `storePackage` 三种声明：`true`（压缩包产出到默认产出区 `dist`）；`false`/缺省（不加工）；对象 `{ form, outDir }`——`form` 取 `archive`（压缩包，默认）或 `exploded`（散装铺进落点目录，覆盖同名文件、保留目录内其他内容），`outDir` 是产出落点（相对协议目录或绝对路径，默认 `dist`）。
5. **脚本指向**：应用 `package.json` 的构建/版本脚本全部指向应用内部 CLI；应用加入独立依赖锚点与锁（不属于 monorepo workspace）。
6. **边界**：应用侧不注册任何发布动作、不持有发布逻辑与凭据。

## 验证

```text
# 应用内自测（按各应用实际命令）
pnpm -C apps/<应用id> test

# 中央调度验证（从主仓库执行）
node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用id> <动作>

# 发布（仅中央，凭据读主仓库 .env）
node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用id> package release
```

参考实现：`apps/ai-draw/`（首个完整范例）。
