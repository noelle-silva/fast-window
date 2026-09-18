export function createAccessActions(deps: {
  accessSettingsController: any
}) {
  const { accessSettingsController } = deps

  return {
    refreshAccessPorts: (force: any) => accessSettingsController.refreshPorts(),
    addAccessPort: (name: any, port: any) => accessSettingsController.addPort(String(name || ''), Number(port)),
    enableAccessPort: (id: any) => accessSettingsController.enablePort(String(id || '')),
    disableAccessPort: (id: any) => accessSettingsController.disablePort(String(id || '')),
    deleteAccessPort: (id: any) => accessSettingsController.deletePort(String(id || '')),
    refreshAccessKeys: (force: any) => accessSettingsController.refreshKeys(),
    addAccessKey: (name: any, expiresAt: any) => accessSettingsController.addKey(String(name || ''), expiresAt === null ? null : String(expiresAt || '') || null),
    revealAccessKey: (id: any) => accessSettingsController.revealKey(String(id || '')),
    setAccessKeyEnabled: (id: any, enabled: any) => accessSettingsController.setKeyEnabled(String(id || ''), enabled === true),
    setAccessKeyExpiration: (id: any, expiresAt: any) => accessSettingsController.setKeyExpiration(String(id || ''), expiresAt === null ? null : String(expiresAt || '') || null),
    deleteAccessKey: (id: any) => accessSettingsController.deleteKey(String(id || '')),
    loadBoxInfo: () => accessSettingsController.loadBoxInfo(),
  }
}
