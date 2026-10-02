import { describe, expect, it } from 'vitest'
import {
  initialViewIntentState,
  onChatSwitched,
  onNodeClicked,
  onRunRegistered,
  onRunStarted,
  resolveFollowTargetMid,
  resolveViewFocusMid,
  selectFollowRun,
  viewIntentAnchorMid,
  type RunViewFact,
  type ViewFocusContext,
  type ViewIntentState,
} from './viewIntent'

// ---------------------------------------------------------------------------
// 场景模拟器：用同一份纯函数状态机跑真实交互序列，验证“看哪里”。
//
// 模拟一个会话：消息树 + 活动运行 + 用户动作（点击节点 / 发起运行 / 运行产出 / 切换会话）。
// 每次动作后读焦点，断言“用户看到的是哪个节点”。
// ---------------------------------------------------------------------------

type Sim = {
  state: ViewIntentState
  messages: Map<string, string> // mid -> parentMid
  runs: RunViewFact[]
  branchHeadMid: string
}

function newSim(): Sim {
  return { state: initialViewIntentState(), messages: new Map(), runs: [], branchHeadMid: '' }
}

function addMessage(sim: Sim, mid: string, parentMid: string): string {
  sim.messages.set(mid, parentMid)
  return mid
}

function setBranchHead(sim: Sim, mid: string) {
  sim.branchHeadMid = mid
}

function context(sim: Sim): ViewFocusContext {
  return { pendingRunAnchorMid: sim.state.pendingRunAnchorMid, runs: sim.runs, branchHeadMid: sim.branchHeadMid }
}

function followTarget(sim: Sim): string {
  return resolveFollowTargetMid(context(sim))
}

function focus(sim: Sim): string {
  return resolveViewFocusMid(sim.state.intent, context(sim))
}

// 用户点击某节点
function click(sim: Sim, mid: string) {
  sim.state = onNodeClicked(sim.state, mid, followTarget(sim))
}

// 用户在某分叉点发起运行（run 稍后由后端登记）
function startRun(sim: Sim, anchorMid: string) {
  sim.state = onRunStarted(sim.state, anchorMid)
}

// 后端登记一次运行（带产出节点）
function registerRun(sim: Sim, runId: string, anchorMid: string, outputMid: string, createdAt: number) {
  sim.runs.push({ runId, anchorMid, outputMid, createdAt })
  sim.state = onRunRegistered(sim.state, anchorMid)
}

// 运行产出推进
function advanceRun(sim: Sim, runId: string, outputMid: string) {
  const run = sim.runs.find((r) => r.runId === runId)
  if (run) run.outputMid = outputMid
}

// 运行结束（移出活动运行）
function finishRun(sim: Sim, runId: string) {
  sim.runs = sim.runs.filter((r) => r.runId !== runId)
}

function switchChat(sim: Sim) {
  sim.state = onChatSwitched()
  sim.runs = []
  sim.branchHeadMid = ''
  sim.messages.clear()
}

// ---------------------------------------------------------------------------
// 基础：消息树构建
//   u1 -> a1 -> u2 -> a2        （主链）
//                  \-> a2b       （同级分支，与 a2 同父 u2）
// ---------------------------------------------------------------------------
function buildMainTree(sim: Sim) {
  addMessage(sim, 'u1', '')
  addMessage(sim, 'a1', 'u1')
  addMessage(sim, 'u2', 'a1')
  addMessage(sim, 'a2', 'u2')
  addMessage(sim, 'a2b', 'u2')
}

describe('viewIntent 场景模拟', () => {
  it('无运行时，跟随目标 = 分支头部', () => {
    const sim = newSim()
    buildMainTree(sim)
    setBranchHead(sim, 'a2')
    expect(focus(sim)).toBe('a2')
  })

  it('点击上游节点 → 锚定；再点跟随目标 → 跟随', () => {
    const sim = newSim()
    buildMainTree(sim)
    setBranchHead(sim, 'a2')

    click(sim, 'a1')
    expect(viewIntentAnchorMid(sim.state.intent)).toBe('a1')
    expect(focus(sim)).toBe('a1')

    click(sim, 'a2')
    expect(viewIntentAnchorMid(sim.state.intent)).toBe('')
    expect(focus(sim)).toBe('a2')
  })

  it('同级分支：点同级分支末端 → 锚定，不被跟随拉走', () => {
    const sim = newSim()
    buildMainTree(sim)
    setBranchHead(sim, 'a2')

    click(sim, 'a2b')
    expect(viewIntentAnchorMid(sim.state.intent)).toBe('a2b')
    expect(focus(sim)).toBe('a2b')

    // 主链产出继续推进，锚定不受影响
    setBranchHead(sim, 'a3')
    expect(focus(sim)).toBe('a2b')
  })

  it('在上游节点发起运行 → 跟随这次运行的产出，而非旧分支头部', () => {
    const sim = newSim()
    buildMainTree(sim)
    setBranchHead(sim, 'a2')

    startRun(sim, 'u1')
    // 空窗期先钉在发起分叉点
    expect(focus(sim)).toBe('u1')

    // 后端登记运行，尚无产出
    registerRun(sim, 'r1', 'u1', '', 100)
    expect(focus(sim)).toBe('u1')

    // 产出新节点：从 u1 分叉出的 a1-new
    addMessage(sim, 'a1-new', 'u1')
    advanceRun(sim, 'r1', 'a1-new')
    expect(focus(sim)).toBe('a1-new')

    // 继续产出
    addMessage(sim, 'a1-new2', 'a1-new')
    advanceRun(sim, 'r1', 'a1-new2')
    expect(focus(sim)).toBe('a1-new2')
  })

  it('多分支并行：跟随最近发起的那次运行，不随输出横跳', () => {
    const sim = newSim()
    buildMainTree(sim)
    setBranchHead(sim, 'a2')

    // 先在上游发起 r1
    startRun(sim, 'u1')
    registerRun(sim, 'r1', 'u1', 'a1-new', 100)
    addMessage(sim, 'a1-new', 'u1')
    expect(focus(sim)).toBe('a1-new')

    // 再发起 r2（更晚）
    startRun(sim, 'u2')
    registerRun(sim, 'r2', 'u2', 'a2-new', 200)
    addMessage(sim, 'a2-new', 'u2')
    expect(focus(sim)).toBe('a2-new')

    // r1 继续产出（更活跃），但跟随目标仍是最近发起的 r2
    advanceRun(sim, 'r1', 'a1-new3')
    expect(focus(sim)).toBe('a2-new')

    // r2 产出推进 → 跟着 r2
    addMessage(sim, 'a2-new2', 'a2-new')
    advanceRun(sim, 'r2', 'a2-new2')
    expect(focus(sim)).toBe('a2-new2')
  })

  it('多分支并行下点同级分支 → 锚定，且不会被其它分支产出拉走', () => {
    const sim = newSim()
    buildMainTree(sim)
    setBranchHead(sim, 'a2')

    startRun(sim, 'u2')
    registerRun(sim, 'r2', 'u2', 'a2-new', 200)
    addMessage(sim, 'a2-new', 'u2')

    // 另一次并行运行 r1
    registerRun(sim, 'r1', 'u1', 'a1-new', 100)
    addMessage(sim, 'a1-new', 'u1')

    // 用户点 a1-new（不是跟随目标 a2-new）→ 锚定
    click(sim, 'a1-new')
    expect(viewIntentAnchorMid(sim.state.intent)).toBe('a1-new')

    // 跟随目标继续推进，锚定不动
    addMessage(sim, 'a2-new2', 'a2-new')
    advanceRun(sim, 'r2', 'a2-new2')
    expect(focus(sim)).toBe('a1-new')
  })

  it('锚定后，点回跟随目标 → 恢复跟随并继续推进', () => {
    const sim = newSim()
    buildMainTree(sim)
    setBranchHead(sim, 'a2')

    startRun(sim, 'u2')
    registerRun(sim, 'r2', 'u2', 'a2-new', 200)
    addMessage(sim, 'a2-new', 'u2')
    const target = followTarget(sim)
    expect(target).toBe('a2-new')

    click(sim, 'u1')
    expect(focus(sim)).toBe('u1')

    click(sim, target)
    expect(viewIntentAnchorMid(sim.state.intent)).toBe('')

    addMessage(sim, 'a2-new2', 'a2-new')
    advanceRun(sim, 'r2', 'a2-new2')
    expect(focus(sim)).toBe('a2-new2')
  })

  it('发起运行的空窗期：即使存在其它旧运行，也先钉在本次分叉点', () => {
    const sim = newSim()
    buildMainTree(sim)
    setBranchHead(sim, 'a2')

    // 旧运行在跑
    registerRun(sim, 'old', 'a2', 'a2-old', 50)
    addMessage(sim, 'a2-old', 'a2')
    expect(focus(sim)).toBe('a2-old')

    // 在上游发起新运行，尚未登记
    startRun(sim, 'u1')
    expect(focus(sim)).toBe('u1')

    // 新运行登记后，转向它的产出
    registerRun(sim, 'new', 'u1', 'a1-new', 200)
    addMessage(sim, 'a1-new', 'u1')
    expect(focus(sim)).toBe('a1-new')
  })

  it('运行结束、无运行 → 回落分支头部（若未锚定）', () => {
    const sim = newSim()
    buildMainTree(sim)
    setBranchHead(sim, 'a2')

    startRun(sim, 'u1')
    registerRun(sim, 'r1', 'u1', 'a1-new', 100)
    addMessage(sim, 'a1-new', 'u1')
    expect(focus(sim)).toBe('a1-new')

    finishRun(sim, 'r1')
    setBranchHead(sim, 'a2')
    expect(focus(sim)).toBe('a2')
  })

  it('锚定状态下运行结束 → 仍停在锚定节点', () => {
    const sim = newSim()
    buildMainTree(sim)
    setBranchHead(sim, 'a2')

    startRun(sim, 'u1')
    registerRun(sim, 'r1', 'u1', 'a1-new', 100)
    addMessage(sim, 'a1-new', 'u1')

    click(sim, 'u1')
    expect(focus(sim)).toBe('u1')

    finishRun(sim, 'r1')
    setBranchHead(sim, 'a2')
    expect(focus(sim)).toBe('u1')
  })

  it('切换会话重置为跟随最新', () => {
    const sim = newSim()
    buildMainTree(sim)
    setBranchHead(sim, 'a2')
    click(sim, 'u1')
    expect(viewIntentAnchorMid(sim.state.intent)).toBe('u1')

    switchChat(sim)
    expect(viewIntentAnchorMid(sim.state.intent)).toBe('')
    addMessage(sim, 'x1', '')
    addMessage(sim, 'x2', 'x1')
    setBranchHead(sim, 'x2')
    expect(focus(sim)).toBe('x2')
  })

  it('在运行产出节点上再发起运行 → 从该产出继续跟随', () => {
    const sim = newSim()
    buildMainTree(sim)
    setBranchHead(sim, 'a2')

    startRun(sim, 'u1')
    registerRun(sim, 'r1', 'u1', 'a1-new', 100)
    addMessage(sim, 'a1-new', 'u1')
    expect(focus(sim)).toBe('a1-new')

    // 在产出节点 a1-new 上再发起（例如工具续跑）
    startRun(sim, 'a1-new')
    expect(focus(sim)).toBe('a1-new')
    registerRun(sim, 'r2', 'a1-new', 'a1-new2', 200)
    addMessage(sim, 'a1-new2', 'a1-new')
    expect(focus(sim)).toBe('a1-new2')
  })

  it('selectFollowRun 取发起时间最晚者', () => {
    const runs: RunViewFact[] = [
      { runId: 'a', anchorMid: 'u1', outputMid: 'x', createdAt: 100 },
      { runId: 'b', anchorMid: 'u2', outputMid: 'y', createdAt: 300 },
      { runId: 'c', anchorMid: 'u3', outputMid: 'z', createdAt: 200 },
    ]
    expect(selectFollowRun(runs)?.runId).toBe('b')
    expect(selectFollowRun([])).toBeNull()
  })

  it('压力：多种子随机点击/发起/产出/结束/切会话，锚定语义恒成立', () => {
    const nodeIds = ['u1', 'a1', 'u2', 'a2', 'a2b']
    const makeRand = (seed0: number) => {
      let seed = seed0 >>> 0
      return () => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
        return seed / 0x100000000
      }
    }

    for (let run = 0; run < 40; run++) {
      const sim = newSim()
      buildMainTree(sim)
      setBranchHead(sim, 'a2')
      const rand = makeRand(1000 + run * 7919)
      let runSeq = 0

      for (let i = 0; i < 200; i++) {
        const action = rand()
        if (action < 0.3) {
          const mid = nodeIds[Math.floor(rand() * nodeIds.length)]
          click(sim, mid)
          // 点击后，焦点必须是该节点（锚定它，或它恰是跟随目标）
          expect(focus(sim)).toBe(mid)
        } else if (action < 0.48) {
          const anchor = nodeIds[Math.floor(rand() * nodeIds.length)]
          startRun(sim, anchor)
          // 发起后，空窗期焦点必须是分叉点
          expect(focus(sim)).toBe(anchor)
        } else if (action < 0.72) {
          runSeq++
          const anchor = nodeIds[Math.floor(rand() * nodeIds.length)]
          const output = `r${run}-${runSeq}-out`
          addMessage(sim, output, anchor)
          registerRun(sim, `r${run}-${runSeq}`, anchor, output, 1000 + i)
        } else if (action < 0.9) {
          if (sim.runs.length) {
            const r = sim.runs[Math.floor(rand() * sim.runs.length)]
            const output = `${r.runId}-adv${i}`
            addMessage(sim, output, r.outputMid || r.anchorMid)
            advanceRun(sim, r.runId, output)
          }
        } else if (action < 0.97) {
          if (sim.runs.length) finishRun(sim, sim.runs[Math.floor(rand() * sim.runs.length)].runId)
        } else {
          switchChat(sim)
          buildMainTree(sim)
          setBranchHead(sim, 'a2')
        }

        // 不变量一：锚定态焦点恒为锚定节点
        const anchor = viewIntentAnchorMid(sim.state.intent)
        if (anchor) expect(focus(sim)).toBe(anchor)

        // 不变量二：跟随态焦点恒等于跟随目标
        if (!anchor) expect(focus(sim)).toBe(followTarget(sim))

        // 不变量三：焦点永远是一个已知节点（非空、非幽灵）
        const f = focus(sim)
        if (f) expect(sim.messages.has(f) || f === sim.branchHeadMid).toBe(true)
      }
    }
  })
})
