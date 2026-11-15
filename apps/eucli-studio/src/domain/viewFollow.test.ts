import { describe, expect, it } from 'vitest'
import { NO_VIEW_FOLLOW, handOffViewFollow, planViewFollow } from './viewFollow'

// 三条曾经出过问题的边界：
//   产出推进不得重搬、用户导航后本次运行作废、导航早于落点就绪也作废。
// 这里守的是「事实不写位置」，与 viewSelection 的解析规则互为两面。

describe('viewFollow 运行落点', () => {
  it('受理后搬一次：落到这次运行的产出节点', () => {
    const plan = planViewFollow(NO_VIEW_FOLLOW, { runId: 'run1', focusMid: 'u3' })
    expect(plan.place).toBe('u3')
    expect(plan.state).toEqual({ placedRunId: 'run1', handedOffRunId: '' })
  })

  it('产出推进不再重搬：同一次运行换了落点也不动', () => {
    const first = planViewFollow(NO_VIEW_FOLLOW, { runId: 'run1', focusMid: 'u3' })
    // 回复落地：产出节点从输入消息推进到助手消息
    const second = planViewFollow(first.state, { runId: 'run1', focusMid: 'a3' })
    expect(second.place).toBe('')
    expect(second.state).toBe(first.state)

    // 工具往返继续推进，仍然不动
    const third = planViewFollow(second.state, { runId: 'run1', focusMid: 'a4' })
    expect(third.place).toBe('')
  })

  it('用户导航后本次运行作废：产出再推进也不把人拽回去', () => {
    const placed = planViewFollow(NO_VIEW_FOLLOW, { runId: 'run1', focusMid: 'u3' })
    // 用户退到上游节点 a1
    const handedOff = handOffViewFollow(placed.state, 'run1')
    expect(handedOff).toEqual({ placedRunId: 'run1', handedOffRunId: 'run1' })

    // 回复开始产出
    const afterReply = planViewFollow(handedOff, { runId: 'run1', focusMid: 'a3' })
    expect(afterReply.place).toBe('')
    expect(afterReply.state).toBe(handedOff)
  })

  it('导航早于落点就绪：卡片到位后也不补搬', () => {
    // 受理了，但产出节点还没进正文：这一帧没有可搬的落点
    const idle = planViewFollow(NO_VIEW_FOLLOW, { runId: 'run1', focusMid: '' })
    expect(idle.place).toBe('')

    // 用户已经退到上游
    const handedOff = handOffViewFollow(idle.state, 'run1')
    // 节点随后就绪
    const ready = planViewFollow(handedOff, { runId: 'run1', focusMid: 'u3' })
    expect(ready.place).toBe('')
  })

  it('用户导航但运行身份缺失：回落到已搬过的那次运行作废', () => {
    const placed = planViewFollow(NO_VIEW_FOLLOW, { runId: 'run1', focusMid: 'u3' })
    const handedOff = handOffViewFollow(placed.state, '')
    expect(handedOff.handedOffRunId).toBe('run1')
  })

  it('新的一次运行照常搬：发送新消息不该被上一次的接管挡住', () => {
    const placed = planViewFollow(NO_VIEW_FOLLOW, { runId: 'run1', focusMid: 'u3' })
    const handedOff = handOffViewFollow(placed.state, 'run1')
    const next = planViewFollow(handedOff, { runId: 'run2', focusMid: 'u5' })
    expect(next.place).toBe('u5')
    expect(next.state).toEqual({ placedRunId: 'run2', handedOffRunId: 'run1' })
  })

  it('空参数不搬：没有运行身份或没有落点都保持原样', () => {
    expect(planViewFollow(NO_VIEW_FOLLOW, { runId: '', focusMid: 'u3' }).place).toBe('')
    expect(planViewFollow(NO_VIEW_FOLLOW, { runId: 'run1', focusMid: '' }).place).toBe('')
  })

  it('重复接管同一次运行不产生新状态：幂等', () => {
    const placed = planViewFollow(NO_VIEW_FOLLOW, { runId: 'run1', focusMid: 'u3' })
    const once = handOffViewFollow(placed.state, 'run1')
    const twice = handOffViewFollow(once, 'run1')
    expect(twice).toBe(once)
  })
})
