import { afterEach, describe, expect, it } from 'vitest'
import {
  disableRenderProbe,
  enableRenderProbe,
  isRenderProbeEnabled,
  recordRender,
  resetRenderProbe,
  snapshotRenderProbe,
} from './renderProbe'

describe('renderProbe', () => {
  afterEach(() => {
    disableRenderProbe()
    resetRenderProbe()
  })

  it('默认关闭，关闭时记录不产生计数', () => {
    expect(isRenderProbeEnabled()).toBe(false)
    recordRender('shell')
    expect(snapshotRenderProbe().counts.shell).toBe(0)
  })

  it('开启后按固定 ID 计数，reset 与 snapshot 语义明确', () => {
    enableRenderProbe()
    recordRender('shell')
    recordRender('shell')
    recordRender('messageRow')
    expect(snapshotRenderProbe().counts.shell).toBe(2)
    expect(snapshotRenderProbe().counts.messageRow).toBe(1)

    resetRenderProbe()
    expect(snapshotRenderProbe().counts.shell).toBe(0)

    disableRenderProbe()
    recordRender('shell')
    expect(snapshotRenderProbe().counts.shell).toBe(0)
  })
})
