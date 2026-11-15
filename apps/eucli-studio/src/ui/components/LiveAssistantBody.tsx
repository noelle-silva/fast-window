import * as React from 'react'
import { hasAssistantAnyOutput, isAssistantGenerating } from '../../domain/assistantRunState'
import { messageVisibleText } from '../../domain/chatMessageDisplay'
import { messageRefreshScope } from '../../domain/uiRefreshScope'
import type { ReasoningDisplayMode } from '../../domain/reasoningDisplay'
import { useScopedUiVersion } from '../hooks/useScopedUiVersion'
import { AssistantMessageBlocks } from './AssistantMessageBlocks'
import { AssistantReplyPendingIndicator } from './AssistantReplyPendingIndicator'
import { useSessionPageVisible } from './SessionPageStack'

// LiveAssistantBody 只订阅“本条消息”的范围：
// 流式推进时仅此组件重渲染并就地读取最新消息，不惊动消息列表与整页。
// 隐藏的保活页不订阅：后台页面不该继续为流式推进做任何工作。
export function LiveAssistantBody(props: {
  controller: any
  mid: string
  message: any
  isGenerating: boolean
  reasoningDisplayMode: ReasoningDisplayMode
  reasoningRenderEnabled: boolean
  renderSafetyPolicyKey: string
  chatRootRef: React.RefObject<HTMLElement | null>
  disabled?: boolean
  // 消息级缓存代际：同一会话共享一代，切会话即整代降级。
  cacheScope?: string
}) {
  const { controller, mid, message, isGenerating, reasoningDisplayMode, reasoningRenderEnabled, renderSafetyPolicyKey, chatRootRef, disabled, cacheScope } = props
  const pageVisible = useSessionPageVisible()
  useScopedUiVersion(controller, messageRefreshScope(mid), pageVisible)
  const live = (mid ? controller?.getMessageById?.(mid) : null) || message
  const hasRuntimeRunState = !!(live?.assistantRun && typeof live.assistantRun === 'object') || typeof live?.pending === 'boolean'
  const liveIsGenerating = hasRuntimeRunState ? isAssistantGenerating(live) : isGenerating
  const awaitingFirstToken = liveIsGenerating && !hasAssistantAnyOutput(live)
  // 首字秒表的起点：运行状态给出的发起时刻；缺少运行时退回消息创建时刻。
  const firstTokenStartedAt = Number(live?.assistantRun?.startedAt || live?.createdAt || 0)
  const text = messageVisibleText(live)
  const parts = Array.isArray(live?.parts) ? live.parts : []
  return (
    <>
      <AssistantMessageBlocks
        controller={controller}
        mid={mid}
        isGenerating={liveIsGenerating}
        text={text}
        parts={parts}
        reasoningDisplayMode={reasoningDisplayMode}
        reasoningRenderEnabled={reasoningRenderEnabled}
        renderSafetyPolicyKey={renderSafetyPolicyKey}
        chatRootRef={chatRootRef}
        disabled={disabled}
        cacheScope={cacheScope}
      />
      {awaitingFirstToken ? <AssistantReplyPendingIndicator startedAtMs={firstTokenStartedAt} /> : null}
    </>
  )
}
