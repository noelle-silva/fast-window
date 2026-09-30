import * as React from 'react'
import { messageVisibleText } from '../../domain/chatMessageDisplay'
import { messageRefreshScope } from '../../domain/uiRefreshScope'
import type { ReasoningDisplayMode } from '../../domain/reasoningDisplay'
import { useScopedUiVersion } from '../hooks/useScopedUiVersion'
import { AssistantMessageBlocks } from './AssistantMessageBlocks'

// LiveAssistantBody 只订阅“本条消息”的范围：
// 流式推进时仅此组件重渲染并就地读取最新消息，不惊动消息列表与整页。
export function LiveAssistantBody(props: {
  controller: any
  mid: string
  message: any
  isGenerating: boolean
  reasoningDisplayMode: ReasoningDisplayMode
  renderSafetyPolicyKey: string
  chatRootRef: React.RefObject<HTMLElement | null>
  disabled?: boolean
}) {
  const { controller, mid, message, isGenerating, reasoningDisplayMode, renderSafetyPolicyKey, chatRootRef, disabled } = props
  useScopedUiVersion(controller, messageRefreshScope(mid))
  const live = (mid ? controller?.getMessageById?.(mid) : null) || message
  const text = messageVisibleText(live)
  const parts = Array.isArray(live?.parts) ? live.parts : []
  return (
    <AssistantMessageBlocks
      controller={controller}
      mid={mid}
      isGenerating={isGenerating}
      text={text}
      parts={parts}
      reasoningDisplayMode={reasoningDisplayMode}
      renderSafetyPolicyKey={renderSafetyPolicyKey}
      chatRootRef={chatRootRef}
      disabled={disabled}
    />
  )
}
