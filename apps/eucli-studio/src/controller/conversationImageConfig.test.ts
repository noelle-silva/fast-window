import { describe, expect, it } from 'vitest'
import {
  CONVERSATION_IMAGE_LIMITS,
  createConversationImageConfigController,
  normalizeConversationImageConfig,
} from './conversationImageConfig'

function createHarness(initialBody: any = {}) {
  const state: any = {}
  const requests: any[] = []
  const toasts: string[] = []
  let emitCount = 0
  const controller = createConversationImageConfigController({
    getState: () => state,
    netRequest: async (request: any) => {
      requests.push(request)
      return { status: 200, body: initialBody }
    },
    emit: () => { emitCount += 1 },
    showToast: (message: string) => { toasts.push(message) },
  })
  return { state, requests, toasts, controller, emitCount: () => emitCount }
}

describe('conversation image config controller', () => {
  it('normalizes missing fields to defaults (all enabled, 2 / 6)', () => {
    expect(normalizeConversationImageConfig(undefined)).toMatchObject({
      multiVersionEnabled: true,
      originalBudgetEnabled: true,
      originalBudgetCount: CONVERSATION_IMAGE_LIMITS.originalBudget.default,
      historyBudgetEnabled: true,
      historyBudgetCount: CONVERSATION_IMAGE_LIMITS.historyBudget.default,
    })
    expect(normalizeConversationImageConfig({ multiVersionEnabled: false, originalBudgetCount: 9999, historyBudgetCount: -1 })).toMatchObject({
      multiVersionEnabled: false,
      originalBudgetCount: CONVERSATION_IMAGE_LIMITS.originalBudget.max,
      historyBudgetCount: CONVERSATION_IMAGE_LIMITS.historyBudget.default,
    })
  })

  it('loads from the business endpoint and saves the edited draft', async () => {
    const harness = createHarness({ multiVersionEnabled: true, originalBudgetEnabled: true, originalBudgetCount: 3, historyBudgetEnabled: true, historyBudgetCount: 8 })
    await harness.controller.refreshConversationImageConfig(true)
    expect(harness.requests[0]).toMatchObject({ method: 'GET', path: '/api/conversation-image/config' })

    harness.controller.setConversationImageConfigDraft('historyBudgetCount', '10')
    const saved = await harness.controller.saveConversationImageConfig()
    expect(saved).toBe(true)
    expect(harness.requests[1]).toMatchObject({
      method: 'PUT',
      path: '/api/conversation-image/config',
      body: { multiVersionEnabled: true, originalBudgetEnabled: true, originalBudgetCount: 3, historyBudgetEnabled: true, historyBudgetCount: 10 },
    })
  })

  it('rejects invalid counts before making a request', async () => {
    const harness = createHarness()
    await harness.controller.refreshConversationImageConfig(true)
    harness.controller.setConversationImageConfigDraft('originalBudgetCount', 'abc')
    const saved = await harness.controller.saveConversationImageConfig()
    expect(saved).toBe(false)
    expect(harness.requests.length).toBe(1)
    expect(harness.toasts.at(-1)).toContain('原图预算张数必须是整数')
  })
})
