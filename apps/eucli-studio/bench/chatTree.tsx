import * as React from 'react'
import { ChatMessageList } from '../src/ui/components/ChatMessageList'
import { buildChatListProps, type BenchController } from './controller'
import { BenchTheme } from './theme'

export function BenchChatList(props: {
  controller: BenchController
  messages: any[]
  cacheScope: string
}) {
  return (
    <BenchTheme>
      <div style={{ width: '100%' }}>
        <ChatMessageList {...buildChatListProps(props.controller, props.messages, props.cacheScope)} />
      </div>
    </BenchTheme>
  )
}
