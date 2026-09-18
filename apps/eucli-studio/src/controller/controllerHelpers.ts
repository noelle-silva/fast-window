import { NEW_ROLE_ID, NEW_GROUP_ID, NEW_WORKSPACE_ID } from '../domain/constants'
import { emptyRoleToolPolicy } from '../domain/toolPolicy'

export function fmtTime(ts: any) {
  try {
    const t = Number(ts || 0)
    if (!isFinite(t) || t <= 0) return ''
    const d = new Date(t)
    const nowD = new Date()
    const pad2 = (n: number) => String(n).padStart(2, '0')
    const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const diffDays = Math.floor((startOfDay(nowD) - startOfDay(d)) / 86400000)
    if (diffDays === 0) return hm
    if (diffDays === 1) return `昨天 ${hm}`
    if (diffDays === 2) return `前天 ${hm}`
    return `${d.getFullYear()}年${pad2(d.getMonth() + 1)}月${pad2(d.getDate())}日 ${hm}`
  } catch (_) {
    return ''
  }
}

export function createModalHelpers(deps: { state: any; render: () => void }) {
  const { state, render } = deps

  function closeModal() {
    // cancelMermaidDrag handled by eventHandlers module
    state.modal = ''
    state.draft.deleteRoleId = ''
    ;(state.draft as any).deleteGroupId = ''
    ;(state.draft as any).deleteWorkspaceId = ''
    state.draft.deleteProviderId = ''
    state.draft.roleToolWhitelistOpen = false
    state.draft.roleToolAddOpen = false
    state.draft.roleToolSearch = ''
    state.draft.roleToolAddSelected = []
    state.draft.roleToolMenuName = ''
    state.draft.roleToolPermissionName = ''
    state.draft.roleNativeToolAddOpen = false
    ;(state.draft as any).renderSafetyPolicyTarget = ''
    state.draft.roleAvatarImageCropSrc = ''
    ;(state.draft as any).groupAvatarImageCropSrc = ''
    if (String(state.draft.editRoleId || '') === NEW_ROLE_ID) {
      state.draft.editRoleId = ''
      state.draft.roleName = ''
      state.draft.roleAvatar = ''
      state.draft.roleAvatarImage = ''
      state.draft.roleAvatarImageCropSrc = ''
      state.draft.roleSystemPrompt = ''
      state.draft.roleProviderId = ''
      state.draft.roleModelId = ''
      state.draft.roleCustomModelId = ''
      state.draft.roleTemperature = '0.7'
      state.draft.roleHookPromptPresetId = ''
      state.draft.roleToolPolicy = emptyRoleToolPolicy()
    }
    if (String((state.draft as any).editGroupId || '') === NEW_GROUP_ID) {
      ;(state.draft as any).editGroupId = ''
      ;(state.draft as any).groupName = ''
      ;(state.draft as any).groupAvatar = ''
      ;(state.draft as any).groupAvatarImage = ''
      ;(state.draft as any).groupAvatarImageCropSrc = ''
      ;(state.draft as any).groupPrompt = ''
      ;(state.draft as any).groupMode = 'roundRobin'
      ;(state.draft as any).groupMemberRoleIds = []
      ;(state.draft as any).groupRoundRobinOrder = []
      ;(state.draft as any).groupRandomWeights = {}
      ;(state.draft as any).groupRandomMinCount = 1
      ;(state.draft as any).groupRandomMaxCount = 2
    }
    if (String((state.draft as any).editWorkspaceId || '') === NEW_WORKSPACE_ID) {
      ;(state.draft as any).editWorkspaceId = ''
      ;(state.draft as any).workspaceName = ''
      ;(state.draft as any).workspacePrompt = ''
      ;(state.draft as any).workspaceDirectories = []
    }
    render()
  }

  return { closeModal }
}
