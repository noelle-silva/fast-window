// 模板一致性检查：应用工具内容必须与中央模板一致，这里只比对、不同步。
// 比对忽略换行符差异：各仓库按自己的 eol 规则检出，同一份内容在工作区里的字节可能不同。

import { readFileSync } from 'node:fs'
import path from 'node:path'

function readNormalizedText(file) {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}

export function checkAppTemplates(inspectedApps, templateFile) {
  const template = readNormalizedText(templateFile)
  return inspectedApps.map(app => {
    if (!app.ok) return { appName: app.appName, appDir: app.appDir, status: 'unavailable', detail: app.error }
    const toolPath = path.join(app.protocolDir, app.toolFile)
    const upToDate = readNormalizedText(toolPath) === template
    return { appName: app.appName, appDir: app.appDir, status: upToDate ? 'up-to-date' : 'outdated', detail: toolPath }
  })
}
