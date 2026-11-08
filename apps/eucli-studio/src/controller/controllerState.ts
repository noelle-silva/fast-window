import { defaultConversationImageConfigState } from './conversationImageConfig'
import { defaultModelGroupsState } from './modelGroups'
import { defaultModelRequestConfigState } from './modelRequestConfig'
import { defaultRequestRecordsState } from './requestRecords'
import { defaultToolWorkDirectoryState } from './toolWorkDirectory'
import { emptyRoleToolPolicy } from '../domain/toolPolicy'
import type { HookPromptLibrary } from '../domain/hookPrompt'
import type { PlaceholderLibrary } from '../domain/placeholder'
import type { DraftImageItem } from '../domain/draftImageUtils'

export function createInitialControllerState() {
  return {
    loading: true,
    activeRunCards: [] as any[],
    sessionComposerDrafts: {} as Record<string, any>,
    activeSessionComposerDraftKey: '',
    modal: '',
    mermaid: { items: [] as any[], index: 0, scale: 1 },
    imageViewer: { items: [] as any[], index: 0, scale: 1 },
    sideTab: 'roles' as string,
    models: { loading: false, error: '', items: [] as any[] },
    modelGroups: defaultModelGroupsState(),
    hookPrompts: { loading: false, error: '', library: { presets: [] } as HookPromptLibrary },
    placeholders: { loading: false, error: '', library: { placeholders: [], folders: [] } as PlaceholderLibrary, preview: { text: '', problems: [] as any[] }, problems: [] as any[], dependencyTree: { name: '' } as any },
    systemPlugins: { loading: false, error: '', items: [] as any[], selectedPluginId: '', selectedPlugin: null as any, detailLoading: false, detailError: '', saving: false, saveError: '', togglingId: '', availableInterfaces: [] as any[], installStates: {} as Record<string, any> },
    tools: { loading: false, error: '', items: [] as any[], fetchedAt: 0, detailLoading: false, detailError: '', selectedToolId: '', selectedTool: null as any, configDraft: {} as Record<string, any>, promptDescriptionDraft: '', saving: false, saveError: '', installStates: {} as Record<string, any> },
    toolWorkDirectory: defaultToolWorkDirectoryState(),
    modelRequestConfig: defaultModelRequestConfigState(),
    conversationImageConfig: defaultConversationImageConfigState(),
    requestRecords: defaultRequestRecordsState(),
    chatSettings: { savingByTarget: {} as Record<string, any> },
    pendingChat: null as any,
    pendingGroupChat: null as any,
    pendingWorkspaceChat: null as any,
    // 正文加载失败的唯一记录点：按 kind+targetId+chatId 分格存放。
    // UI 只读「当前目标会话」那一格进入 FAILED 终态（错误占位 + 重试），
    // 并发失败互不覆盖；任何一次成功加载只清空自己这一格。
    chatLoadFailures: {} as Record<string, { kind: 'role' | 'group' | 'workspace'; targetId: string; chatId: string; reason: string }>,
    branchDraft: null as any,
    // 最后一次由我发起的运行身份：受理时写入。视图据此把位置搬到这次运行的节点，只搬一次。
    followRun: '',
    draft: {
      input: '',
      images: [] as DraftImageItem[],
      activeTargetKind: 'role' as string,
      activeRoleId: '',
      activeGroupId: '',
      activeWorkspaceId: '',

      editRoleId: '',
      roleName: '',
      roleDescription: '',
      roleAvatarImage: '',
      roleAvatarImageCropSrc: '',
      roleSystemPrompt: '',
      roleModelCandidates: [] as any[],
      roleDefaultModelCandidateId: '',
      roleProviderId: '',
      roleModelId: '',
      roleModelSource: 'provider',
      roleModelGroupId: '',
      roleModelGroupModelId: '',
      roleTemperature: '1',
      roleTemperatureEnabled: false,
      roleHookPromptPresetId: '',
      roleToolPolicy: emptyRoleToolPolicy(),
      roleToolAddOpen: false,
      roleToolSearch: '',
      roleToolAddSelected: [] as string[],

      editGroupId: '',
      groupName: '',
      groupAvatarImage: '',
      groupAvatarImageCropSrc: '',
      groupPrompt: '',
      groupMode: 'roundRobin' as string,
      groupMemberRoleIds: [] as string[],
      groupRoundRobinOrder: [] as string[],
      groupRandomWeights: {} as Record<string, number>,
      groupRandomMinCount: 1,
      groupRandomMaxCount: 2,

      editWorkspaceId: '',
      workspaceName: '',
      workspaceDescription: '',
      workspacePrompt: '',
      workspaceDirectories: [] as Array<{ path: string; alias: string; description: string }>,
      workspaceRegisteredRoleIds: [] as string[],
      // 工作区身份图标草稿：kind 为空即「没有图标」，initial 是打开编辑器时的图标基线。
      workspaceIconKind: '' as string,
      workspaceIconSvg: '',
      workspaceIconDataUrl: '',
      workspaceIconInitial: '',

      editProviderId: '',
      providerName: '',
      providerBaseUrl: '',
      providerApiKey: '',
      providerProtocol: '',
      providerApiKeyStrategy: 'sequential',
      providerApiKeys: [] as any[],
      providerRegisteredModels: [] as any[],

      deleteRoleId: '',
      deleteGroupId: '',
      deleteWorkspaceId: '',
      deleteProviderId: '',
      renderSafetyPolicyTarget: '',
      colorThemeDraft: null as any,
    } as any,
    data: null as any,
  }
}
