// 模板一致性检查：应用工具必须与中央模板逐字节一致，这里只比对、不同步。

import { readFileSync } from 'node:fs'
import path from 'node:path'

export function checkAppTemplates(inspectedApps, templateFile) {
  const template = readFileSync(templateFile)
  return inspectedApps.map(app => {
    if (!app.ok) return { appName: app.appName, appDir: app.appDir, status: 'unavailable', detail: app.error }
    const toolPath = path.join(app.protocolDir, app.toolFile)
    const upToDate = readFileSync(toolPath).equals(template)
    return { appName: app.appName, appDir: app.appDir, status: upToDate ? 'up-to-date' : 'outdated', detail: toolPath }
  })
}
