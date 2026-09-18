export function createModelActions(deps: {
  refreshModelRequestConfig: (force: boolean) => any
  setModelRequestConfigDraft: (key: any, value: any) => any
  resetModelRequestConfigDraftToDefaults: () => any
  saveModelRequestConfig: () => any
  refreshModelGroups: (force: boolean) => any
  saveModelGroups: () => any
  createModelGroup: () => any
  deleteModelGroup: (groupId: any) => any
  setModelGroupField: (groupId: any, field: any, value: any) => any
  createModelGroupModel: (groupId: any) => any
  deleteModelGroupModel: (groupId: any, modelIndex: any) => any
  setModelGroupModelField: (groupId: any, modelIndex: any, field: any, value: any) => any
  createModelGroupMember: (groupId: any, modelIndex: any) => any
  deleteModelGroupMember: (groupId: any, modelIndex: any, memberIndex: any) => any
  setModelGroupMemberField: (groupId: any, modelIndex: any, memberIndex: any, field: any, value: any) => any
  refreshModels: (providerId: string, force: boolean) => any
}) {
  const { refreshModelRequestConfig, setModelRequestConfigDraft, resetModelRequestConfigDraftToDefaults, saveModelRequestConfig, refreshModelGroups, saveModelGroups, createModelGroup, deleteModelGroup, setModelGroupField, createModelGroupModel, deleteModelGroupModel, setModelGroupModelField, createModelGroupMember, deleteModelGroupMember, setModelGroupMemberField, refreshModels } = deps

  return {
    refreshModelRequestConfig: (force: any) => refreshModelRequestConfig(!!force),
    setModelRequestConfigDraft: (key: any, value: any) => setModelRequestConfigDraft(key, value),
    resetModelRequestConfigDraftToDefaults: () => resetModelRequestConfigDraftToDefaults(),
    saveModelRequestConfig: () => saveModelRequestConfig(),
    refreshModelGroups: (force: any) => refreshModelGroups(!!force),
    saveModelGroups: () => saveModelGroups(),
    createModelGroup: () => createModelGroup(),
    deleteModelGroup: (groupId: any) => deleteModelGroup(groupId),
    setModelGroupField: (groupId: any, field: any, value: any) => setModelGroupField(groupId, field, value),
    createModelGroupModel: (groupId: any) => createModelGroupModel(groupId),
    deleteModelGroupModel: (groupId: any, modelIndex: any) => deleteModelGroupModel(groupId, modelIndex),
    setModelGroupModelField: (groupId: any, modelIndex: any, field: any, value: any) => setModelGroupModelField(groupId, modelIndex, field, value),
    createModelGroupMember: (groupId: any, modelIndex: any) => createModelGroupMember(groupId, modelIndex),
    deleteModelGroupMember: (groupId: any, modelIndex: any, memberIndex: any) => deleteModelGroupMember(groupId, modelIndex, memberIndex),
    setModelGroupMemberField: (groupId: any, modelIndex: any, memberIndex: any, field: any, value: any) => setModelGroupMemberField(groupId, modelIndex, memberIndex, field, value),
    refreshModels: (providerId: any, force: any) => refreshModels(String(providerId || ''), !!force),
  }
}
