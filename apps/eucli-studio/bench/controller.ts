import type * as React from 'react'
import { createRenderTestCapabilities } from '../src/render/testing/capabilities'
import type { ChatMessageList } from '../src/ui/components/ChatMessageList'

export type BenchController = {
  renderAssistantInto: (el: unknown, text: unknown, options?: any) => void
  getMessageById: (mid: string) => null
  getScopeVer: () => number
  subscribeScope: () => () => void
  getSnapshot: () => number
  subscribe: () => () => void
  fmtTime: () => string
  actions: { openMermaidViewer: () => void }
}

export function createBenchController(engine: {
  renderAssistantInto: (el: unknown, text: unknown, options?: any) => void
}): BenchController {
  return {
    renderAssistantInto: (el, text, options) => engine.renderAssistantInto(el, text, options),
    getMessageById: () => null,
    getScopeVer: () => 0,
    subscribeScope: () => () => {},
    getSnapshot: () => 0,
    subscribe: () => () => {},
    fmtTime: () => '',
    actions: { openMermaidViewer: () => {} },
  }
}

export function makeBenchMessage(id: string, text: string, createdAt = 1) {
  return {
    id,
    type: 'assistant',
    role: 'assistant',
    speakerRoleId: '',
    content: text,
    parts: [{ id: `${id}:text`, type: 'text', text, createdAt, updatedAt: createdAt }],
    images: [],
    toolImages: [],
    modelDurationMs: 1200,
    branchId: 'main',
    parentMid: '',
    createdAt,
    updatedAt: createdAt,
    modelRef: null,
    pending: false,
    streaming: false,
  }
}

export function makeBenchMessages(texts: string[], seed = 'm') {
  return texts.map((text, index) => makeBenchMessage(`${seed}-${index}`, text, 1 + index))
}

// 这些对象必须跨批次保持同一身份：ChatMessageList 的 uiPolicy / actions
// 用引用相等做行级 memo，若每批重建会让所有已上屏行整树重渲染，污染分批基准。
const NOOP = () => {}
const ROLES: any[] = []
const ACTIVE_ROLE = { id: 'bench-role', name: '基准助手' }
const EMPTY_LIST: any[] = []
const EMPTY_STRING_MAP = new Map<string, string>()
const EMPTY_SIBLINGS_MAP = new Map<string, any[]>()
const EMPTY_STRING_SET = new Set<string>()
const STICKER_MAP = {}
const EDITING = { mid: '', text: '' }
const CHAT_ROOT_REF = { current: null }
const FORMAT_MODEL_REF = () => ''
const NEVER_BLOCKED = () => false

const ACTIONS = {
  onMessageContextMenu: NOOP,
  onToggleToolMessage: NOOP,
  onToggleUserMessage: NOOP,
  onEditTextChange: NOOP,
  onCancelEditMessage: NOOP,
  onSaveEditMessage: NOOP,
  onStartEditMessage: NOOP,
  onCopyMessageText: NOOP,
  onSwitchBranchSibling: NOOP,
  onRegenerate: NOOP,
  onDeleteMessage: NOOP,
}

export function buildChatListProps(controller: BenchController, messages: any[], cacheScope: string) {
  const props: React.ComponentProps<typeof ChatMessageList> = {
    controller,
    messages,
    roles: ROLES,
    activeRole: ACTIVE_ROLE,
    activeTargetKind: 'role',
    activeVisibleRunCards: EMPTY_LIST,
    prevAiMidByAssistantId: EMPTY_STRING_MAP,
    assistantSiblingsByPrevAiMid: EMPTY_SIBLINGS_MAP,
    chatAllMessagesRaw: messages,
    expandedToolMsgIds: EMPTY_STRING_SET,
    expandedUserMsgIds: EMPTY_STRING_SET,
    editingMsg: EDITING,
    loading: false,
    uiBusy: false,
    userMessageCollapseEnabled: false,
    userMessageCollapseLines: 4,
    reasoningDisplayMode: 'collapse-when-done',
    reasoningRenderEnabled: false,
    stickersEnabled: false,
    stickerMap: STICKER_MAP,
    renderSafetyPolicyKey: 'original',
    chatRootRef: CHAT_ROOT_REF,
    cacheScope,
    formatModelRefText: FORMAT_MODEL_REF,
    messageMutationBlocked: NEVER_BLOCKED,
    ...ACTIONS,
  }
  return props
}

export { createRenderTestCapabilities as createBenchCapabilities }
