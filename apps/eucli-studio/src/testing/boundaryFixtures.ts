// 四条状态边界的契约测试夹具。
//
// 形状全部取自业务端真实响应 / 真实事件序列 / 真实 sessionIndex 快照：
//   - 会话文档：id、ISO 时间、parentMessageId、branching 都是线格式原样；
//   - 运行事件：取自 dev 实例抓包的一条正常完成消息；
//   - 索引快照：scope / activeChatId / chatIds / chatUpdatedAt / chatMetas / revision。
//
// 这里只放数据，不放断言。所有 id 均为合成值，不包含任何真实密钥或隐私。

import { CHAT_BRANCHING_SCHEMA_VERSION, VERSION } from '../domain/constants'

export const BOUNDARY_ROLE_ID = 'role-1'
export const BOUNDARY_CHAT_ID = 'chat-1793460437483209000-17743'
export const SECOND_CHAT_ID = 'chat-1793460500000000000-17801'
export const THIRD_CHAT_ID = 'chat-1793460600000000000-17899'

export const USER_MESSAGE_ID = 'message-1793460437483209000-17743'
export const ASSISTANT_MESSAGE_ID = 'message-1793460445487972300-17745'
export const SECOND_USER_MESSAGE_ID = 'message-1793460460000000000-17746'
export const SECOND_ASSISTANT_MESSAGE_ID = 'message-1793460470000000000-17747'
export const ALT_MESSAGE_ID = 'message-1793460480000000000-17750'

export const RUN_ID = 'run-1793460437472526500-17741'
export const MODEL_RESPONSE_ID = '01a192929b3001c78cc9db2263cbf862'
export const TOOL_PLAN_ID = 'tool-plan-1793452072626493300-17230'

const CREATED_AT = '2026-10-31T17:32:31.8294373Z'
const FIRST_ASSISTANT_AT = '2026-10-31T17:32:35.0548421Z'
const SECOND_USER_AT = '2026-10-31T17:38:02.5199299Z'
const SECOND_ASSISTANT_AT = '2026-10-31T17:39:10.0000000Z'
const ALT_AT = '2026-10-31T17:39:14.4078946Z'

// 业务端 session.get / session.window 的原始会话文档形状。
// main 分支头部停在 a2，而更晚的 alt 分支消息在数组末尾：
// 归一化必须保留「已存分支头」，不能按数组末端把视图拉回其它分支。
export function rawSessionDocument() {
  return {
    id: BOUNDARY_CHAT_ID,
    roleId: BOUNDARY_ROLE_ID,
    title: '分支与窗口回归',
    status: 'completed',
    createdAt: CREATED_AT,
    updatedAt: ALT_AT,
    schemaVersion: 1,
    asyncToolTasks: [],
    messages: [
      {
        id: USER_MESSAGE_ID,
        type: 'user',
        role: 'user',
        content: '第一问',
        branchId: 'main',
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
      {
        id: ASSISTANT_MESSAGE_ID,
        type: 'assistant',
        role: 'assistant',
        content: '第一答',
        parentMessageId: USER_MESSAGE_ID,
        branchId: 'main',
        createdAt: FIRST_ASSISTANT_AT,
        updatedAt: FIRST_ASSISTANT_AT,
      },
      {
        id: SECOND_USER_MESSAGE_ID,
        type: 'user',
        role: 'user',
        content: '第二问',
        parentMessageId: ASSISTANT_MESSAGE_ID,
        branchId: 'main',
        createdAt: SECOND_USER_AT,
        updatedAt: SECOND_USER_AT,
      },
      {
        id: SECOND_ASSISTANT_MESSAGE_ID,
        type: 'assistant',
        role: 'assistant',
        content: '第二答',
        parentMessageId: SECOND_USER_MESSAGE_ID,
        branchId: 'main',
        createdAt: SECOND_ASSISTANT_AT,
        updatedAt: SECOND_ASSISTANT_AT,
      },
      {
        id: ALT_MESSAGE_ID,
        type: 'assistant',
        role: 'assistant',
        content: '另一条分支的回答',
        parentMessageId: USER_MESSAGE_ID,
        branchId: 'alt',
        createdAt: ALT_AT,
        updatedAt: ALT_AT,
      },
    ],
    branching: {
      schemaVersion: CHAT_BRANCHING_SCHEMA_VERSION,
      activeBranchId: 'main',
      branches: [
        {
          id: 'main',
          name: '主分支',
          headMid: SECOND_ASSISTANT_MESSAGE_ID,
          createdAt: Date.parse(CREATED_AT),
          updatedAt: Date.parse(SECOND_ASSISTANT_AT),
          forkFromMid: '',
        },
        {
          id: 'alt',
          name: '另一分支',
          headMid: ALT_MESSAGE_ID,
          createdAt: Date.parse(CREATED_AT),
          updatedAt: Date.parse(ALT_AT),
          forkFromMid: USER_MESSAGE_ID,
        },
      ],
    },
  }
}

// 完整数据文档形状：归一化入口 normalizeData 的真实输入。
export function rawSessionDataDocument() {
  return {
    version: VERSION,
    settings: {},
    favorites: { folders: [], chatRefsByFolderId: {} },
    roles: [
      {
        id: BOUNDARY_ROLE_ID,
        name: '角色 A',
        createdAt: 1,
        updatedAt: 1,
        modelCandidates: [],
        defaultModelCandidateId: '',
      },
    ],
    chatsByRole: {
      [BOUNDARY_ROLE_ID]: {
        activeChatId: BOUNDARY_CHAT_ID,
        chats: [rawSessionDocument()],
      },
    },
    groups: [],
    chatsByGroup: {},
    workspaces: [],
    chatsByWorkspace: {},
    ui: {
      activeTargetKind: 'role',
      activeRoleId: BOUNDARY_ROLE_ID,
      activeGroupId: '',
      activeWorkspaceId: '',
    },
  }
}

// 真实 sessionIndex.get 的单个 index 形状（scope 已在服务端组装）。
export function rawSessionIndexSnapshot() {
  return {
    scope: `role:${BOUNDARY_ROLE_ID}`,
    activeChatId: SECOND_CHAT_ID,
    chatIds: [SECOND_CHAT_ID, BOUNDARY_CHAT_ID],
    chatUpdatedAt: {
      [SECOND_CHAT_ID]: 1793460600000,
      [BOUNDARY_CHAT_ID]: 1793460520000,
    },
    chatMetas: [
      {
        id: SECOND_CHAT_ID,
        title: '会话 B',
        createdAt: 1793460500000,
        updatedAt: 1793460600000,
        lastMessagePreview: 'B 的最新消息',
        messageCount: 12,
        hasPending: false,
        runStatus: 'idle',
        runStatusChangedAt: 1793460600000,
      },
      {
        id: BOUNDARY_CHAT_ID,
        title: '会话 A',
        createdAt: 1793460437000,
        updatedAt: 1793460520000,
        lastMessagePreview: 'A 的最新消息',
        messageCount: 8,
        hasPending: false,
        runStatus: 'completed',
        runStatusChangedAt: 1793460520000,
      },
    ],
    updatedAt: 1793460700000,
    revision: 42,
  }
}

// dev 实例抓包的一条正常完成消息：run_started → delta → model_output →
// tool_requested → assistant_message_update → run_completed。
// model_output 的载荷 id 是模型响应编号，tool_requested 的载荷 id 是工具计划编号。
export function realRunEventSequence() {
  return [
    {
      id: '',
      runId: RUN_ID,
      type: 'run_started',
      payload: {
        id: RUN_ID,
        roleId: BOUNDARY_ROLE_ID,
        sessionId: BOUNDARY_CHAT_ID,
        inputMessageId: USER_MESSAGE_ID,
        lastMessageId: USER_MESSAGE_ID,
        status: 'running',
        stream: true,
      },
    },
    {
      id: '',
      runId: RUN_ID,
      type: 'assistant_message_delta',
      payload: {
        runId: RUN_ID,
        roleId: BOUNDARY_ROLE_ID,
        sessionId: BOUNDARY_CHAT_ID,
        messageId: ASSISTANT_MESSAGE_ID,
        parentMessageId: USER_MESSAGE_ID,
        messageType: 'assistant',
        messageCreatedAt: Date.parse(FIRST_ASSISTANT_AT),
        contentDelta: 'OK',
        stream: true,
      },
    },
    {
      id: '',
      runId: RUN_ID,
      type: 'model_output',
      payload: { id: MODEL_RESPONSE_ID, content: 'OK', reasoning: '' },
    },
    {
      id: '',
      runId: RUN_ID,
      type: 'tool_requested',
      payload: {
        id: TOOL_PLAN_ID,
        roleId: BOUNDARY_ROLE_ID,
        scope: { roleId: BOUNDARY_ROLE_ID, sessionId: BOUNDARY_CHAT_ID },
        action: { id: 'intent-1', toolName: 'shell_command' },
        planStatus: 'ready',
      },
    },
    {
      id: '',
      runId: RUN_ID,
      type: 'assistant_message_update',
      payload: {
        runId: RUN_ID,
        roleId: BOUNDARY_ROLE_ID,
        sessionId: BOUNDARY_CHAT_ID,
        stream: true,
        status: 'completed',
        message: {
          id: ASSISTANT_MESSAGE_ID,
          type: 'assistant',
          role: 'assistant',
          content: 'OK',
          parentMessageId: USER_MESSAGE_ID,
          createdAt: FIRST_ASSISTANT_AT,
          updatedAt: FIRST_ASSISTANT_AT,
        },
      },
    },
    {
      id: '',
      runId: RUN_ID,
      type: 'run_completed',
      payload: {
        id: RUN_ID,
        roleId: BOUNDARY_ROLE_ID,
        sessionId: BOUNDARY_CHAT_ID,
        inputMessageId: USER_MESSAGE_ID,
        lastMessageId: ASSISTANT_MESSAGE_ID,
        status: 'completed',
      },
    },
  ]
}
