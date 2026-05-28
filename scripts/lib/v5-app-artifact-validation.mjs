import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const V5_APP_TAURI_CONFIG_BY_PROFILE = {
  release: 'src-tauri/tauri.conf.json',
  dev: 'src-tauri/tauri.conf.dev.json',
}

function tauriConfigPathForProfile(config, profileId) {
  const rel = V5_APP_TAURI_CONFIG_BY_PROFILE[profileId]
  if (!rel) throw new Error(`v5 app profile 不支持产物验收: ${profileId}`)
  return path.join(config.appDir, rel)
}

async function expectedProductName(config, profileId) {
  const configPath = tauriConfigPathForProfile(config, profileId)
  const raw = await fs.readFile(configPath, 'utf8').catch(error => {
    throw new Error(`读取 v5 app Tauri 配置失败: ${configPath} (${error.message})`)
  })
  const value = JSON.parse(raw)
  const productName = String(value?.productName || '').trim()
  if (!productName) throw new Error(`v5 app Tauri 配置缺少 productName: ${configPath}`)
  return productName
}

function powershellExeVersionInfo(exePath) {
  return new Promise((resolve, reject) => {
    const script = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '$path = [Environment]::GetEnvironmentVariable("FW_EXE_VERSION_PATH")',
      '$v = (Get-Item -LiteralPath $path).VersionInfo',
      '[pscustomobject]@{ FileDescription = $v.FileDescription; ProductName = $v.ProductName } | ConvertTo-Json -Compress',
    ].join('; ')
    const child = spawn('powershell', ['-NoProfile', '-Command', script], {
      env: { ...process.env, FW_EXE_VERSION_PATH: exePath },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('exit', code => {
      if ((code ?? 0) !== 0) {
        reject(new Error(`读取 exe 元数据失败: ${exePath} (${stderr.trim() || `exit ${code}`})`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (error) {
        reject(new Error(`解析 exe 元数据失败: ${exePath} (${error.message})`))
      }
    })
  })
}

export async function validateV5AppWindowsExecutableMetadata(config, profileId, executablePath) {
  if (process.platform !== 'win32') return { skipped: true, reason: 'non-windows' }

  const expected = await expectedProductName(config, profileId)
  const info = await powershellExeVersionInfo(executablePath)
  const fileDescription = String(info?.FileDescription || '').trim()
  const productName = String(info?.ProductName || '').trim()
  const mismatches = []
  if (fileDescription !== expected) mismatches.push(`FileDescription=${fileDescription || '(empty)'}`)
  if (productName !== expected) mismatches.push(`ProductName=${productName || '(empty)'}`)
  if (mismatches.length) {
    throw new Error([
      `v5 app Windows exe 元数据与 Tauri productName 不一致: ${executablePath}`,
      `expected=${expected}`,
      `actual=${mismatches.join(', ')}`,
      '这通常表示构建环境继承了外部 TAURI_CONFIG，已阻断继续发布。',
    ].join('\n'))
  }
  return { skipped: false, expected, fileDescription, productName }
}
