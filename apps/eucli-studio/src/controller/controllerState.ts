import { defaultModelGroupsState } from './modelGroups'
import { defaultModelRequestConfigState } from './modelRequestConfig'
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
    chatSettings: { savingByTarget: {} as Record<string, any> },
    pendingChat: null as any,
    pendingGroupChat: null as any,
    pendingWorkspaceChat: null as any,
    branchDraft: null as any,
    draft: {
      input: '',
      images: [] as DraftImageItem[],
      activeTargetKind: 'role' as string,
      activeRoleId: '',
      activeGroupId: '',
      activeWorkspaceId: '',

      editRoleId: '',
      roleName: '',
      roleAvatarImage: '',
      roleAvatarImageCropSrc: '',
      roleSystemPrompt: '',
      roleProviderId: '',
      roleModelId: '',
      roleCustomModelId: '',
      roleModelSource: 'provider',
      roleModelGroupId: '',
      roleModelGroupModelId: '',
      roleTemperature: '0.7',
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
      workspacePrompt: '',
      workspaceDirectories: [] as Array<{ path: string; alias: string; description: string }>,

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
    } as any,
    data: null as any,
  }
}
