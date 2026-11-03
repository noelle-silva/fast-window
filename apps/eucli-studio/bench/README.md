# 渲染基准（bench）

在真实 Chromium 中测量 `src/render/unified/engine.ts` 的“文字 → HTML 字符串 → DOM”管线，以及 React + MUI 消息树、后台解析、分批上屏和滚动的成本。

## 一条命令

在 `apps/eucli-studio` 下执行：

```bash
node bench/run-bench.mjs
```

脚本会：

1. 用 `bench/vite.bench.config.ts` 启动独立 Vite 开发服务器（默认自动选端口，从 1459 开始）；
2. 启动无头 Chrome/Edge（不打开桌面窗口）；
3. 等待页面 `window.__BENCH_READY__ === true`；
4. 调用 `window.__BENCH__.runAll()`，打印表格；
5. 关闭自己创建的 Vite 与浏览器进程。

常用选项：

```bash
node bench/run-bench.mjs --json                 # 输出原始 JSON
node bench/run-bench.mjs --port 1460            # 指定 Vite 端口
node bench/run-bench.mjs --chrome "C:\...\chrome.exe"
node bench/run-bench.mjs --url http://127.0.0.1:1459/   # 复用已启动的页面
```

浏览器也可以通过环境变量指定：`CHROME_PATH`、`CHROME_BIN`、`EDGE_PATH`。

## 依赖说明

- Node 22+（脚本使用内置全局 `WebSocket` 直连 CDP）。
- 应用现有的 `vite`、`react`、`@mui/material` 等依赖（复用 `apps/eucli-studio/node_modules`）。
- 本机安装 Chrome 或 Edge。

**不需要** `playwright` / `puppeteer`，不新增 `bench/package.json`，不改应用 `package.json` 与锁文件。

## 指标含义

| 指标 | 含义 |
| --- | --- |
| 单条 · 引擎 ms | 真实引擎同步完成解析、消毒、DOM 提交，并强制一次文档排版的总耗时 |
| 单条 · React+MUI ms | 已挂载消息更新一次正文（真实 `ChatMessageList` → `MessageRow` → `AssistantMessageHost`）并强制排版；不含 React 根首次挂载 |
| 节点 / 高度 | 渲染完成后宿主内的元素数量与布局高度 |
| 批量总 ms / 每条 ms | N 条消息在独立宿主上批量渲染并强制排版；`每条 = 总 / N` |
| 引擎/条 ×基 | 相对最小批量（5 条）的每条成本倍率；接近 1 说明成本恒定 |
| 并行解析 | 同一套纯解析管线在主线程串行 vs 1/4/8 个 Worker 的墙钟耗时 |
| Worker 产出上屏 | Worker 生成的 HTML 直接 `innerHTML`（含布局）的耗时，以及补上主线程消毒后的耗时 |
| 分批上屏 | 400 条，首屏 5 条、每批 10 条；对比固定 80 ms 等待与 `scheduler.yield` 时间片让出 |
| 滚动帧率 | 400 条已上屏消息在 2000 ms 往返滚动中的帧数、FPS、掉帧数与帧间隔分布 |

说明：

- 所有计时都排除预热：引擎、React 组件树、纯解析管线、Worker 和 HTML 注入都会先跑预热轮。
- 单条与批量数字取多轮中位数，避免单次 GC 抖动。
- “渲染 + 强制排版”通过读取 `document.body.offsetHeight` 触发真实布局；不会把 detached 节点误当成已布局。
- 滚动掉帧阈值取 60 Hz 帧间隔的 1.5 倍（25 ms）；它衡量帧节奏，不是单次绘制耗时。

## 如何新增测量项

1. 在 `bench/` 下新增独立测量模块，输入输出使用 `types.ts` 中的类型。
2. 测量函数必须：
   - 先预热，再计时；
   - 把宿主节点连接到文档；
   - 在计时区间内调用 `forceLayout()`（见 `stats.ts`），否则布局成本不会被计入；
   - 清理挂载的 React 根与 DOM。
3. 在 `runBench.ts` 的 `runAll()` 中按阶段调用（每阶段前可 `clearStage()`），把结果并入 `BenchResults`。
4. 在 `run-bench.mjs` 的 `printResults()` 中增加对应表格。
5. 若新增的是后台线程解析项，复用 `parsePipeline.ts`；不要复制业务实现。需要新的 Worker 时参考 `parse.worker.ts` + `workerPool.ts`。
6. 运行 `npx tsc -p bench/tsconfig.json --noEmit` 检查基准代码本身。

## 后台线程与 `decode-named-character-reference`

`decode-named-character-reference` 的 `exports.browser` 指向 `index.dom.js`，该文件在模块顶层执行 `document.createElement`，在 Worker 中会直接崩溃。

`bench/vite.bench.config.ts` 只在 bench 配置里把该模块别名到 `index.js`（与 Node 使用同一实现）。应用的 `vite.config.ts`、生产源码与生产构建均未改动。

## 目录结构

```
bench/
├── index.html               # 测量页面
├── main.tsx                 # 页面入口，暴露 __BENCH__ / __BENCH_READY__
├── runBench.ts              # 测量编排
├── engineBench.ts           # a/b：真实引擎单条与批量
├── reactBench.tsx           # c：React + MUI 单条与批量
├── parallelBench.ts         # d/e：并行解析与 Worker HTML 上屏
├── sessionBench.tsx         # f：分批上屏策略
├── scrollBench.tsx          # g：滚动帧率
├── parsePipeline.ts         # 纯字符串解析（复用应用真实前置模块与插件）
├── parse.worker.ts          # 后台解析 Worker
├── workerPool.ts            # Worker 池
├── fixtures.ts              # 文本/公式/表格/代码块样本
├── controller.ts            # 真实消息组件的控制器桩
├── chatTree.tsx             # 真实 ChatMessageList 的挂载包装
├── theme.tsx                # 应用主题与全局样式
├── stage.ts / stats.ts      # 宿主、强制排版、统计工具
├── types.ts                 # 结果类型
├── vite.bench.config.ts     # bench 独立 Vite 配置
└── run-bench.mjs            # 零依赖 CDP 驱动
```

## 已知局限

- Worker 侧只测“解析 → HTML 字符串”，不含消毒与 DOM（DOMPurify 依赖真实 DOM）；`e` 的“消毒 + innerHTML”列补上主线程消毒成本。
- React 批量使用真实 `ChatMessageList` / `MessageRow`，但控制器是桩：不包含真实会话状态、订阅与滚动锚定逻辑。
- 分批上屏是等价模拟：真实 hook 向上前插历史并双 rAF 揭示批次；这里使用短样本按到达顺序追加、每批只计量 React 提交、末尾统一强制一次排版，以隔离等待策略。历史前插引发的整表重排属于另一类成本，由批量表与真实会话共同覆盖。
- 滚动帧率受无头浏览器合成器与机器负载影响，适合横向比较，不宜当作绝对设备性能。
- `--headless=new` 下字体、GPU 与真实桌面窗口仍有差异。
