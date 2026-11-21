// 中央调度工具的命令行参数解析：只负责把 argv 翻译成命令描述，不触碰文件系统。
// 应用名是否合法、是否登记由注册表裁决，这里只认形态。

export const releaseMode = 'release'

export const usageText = [
  '用法：',
  '  node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用名> <动作代号> [release]',
  '  node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用名> --verify [--zip <成品包>] [--catalog <本地目录文件>]',
  '  node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用名> --unpublish [--dry-run]',
  '  node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用名> --register <应用根目录绝对路径>',
  '  node .fast-window-dev-protocol/fast-window-dev-tool.mjs --list',
  '  node .fast-window-dev-protocol/fast-window-dev-tool.mjs --check-templates',
].join('\n')

function isSafeSegment(value) {
  return typeof value === 'string' && value !== '' && value !== '.' && value !== '..' && !/[\\/]/.test(value)
}

function usageError(detail) {
  return new Error(detail ? `${detail}\n${usageText}` : usageText)
}

function parseGlobalArgs(args) {
  const [command, ...rest] = args
  if (rest.length > 0) throw usageError(`${command} 不接受额外参数：${rest.join(' ')}`)
  if (command === '--list') return { kind: 'list' }
  if (command === '--check-templates') return { kind: 'check-templates' }
  throw usageError(`不支持的全局命令：${command}`)
}

function parseActionArgs(appName, rest) {
  const [action, mode = '', ...extra] = rest
  if (extra.length > 0 || !isSafeSegment(action)) throw usageError()
  if (mode !== '' && mode !== releaseMode) {
    throw new Error(`暂不支持的第三参数：${mode}（目前只支持 ${releaseMode}）`)
  }
  return { kind: 'action', appName, action, mode }
}

function parseVerifyArgs(appName, rest) {
  const out = { kind: 'verify', appName, zip: '', catalog: '' }
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    if ((arg === '--zip' || arg === '--catalog') && i + 1 < rest.length) {
      const value = String(rest[++i] ?? '').trim()
      if (!value) throw new Error(`${arg} 不能为空`)
      out[arg.slice(2)] = value
      continue
    }
    throw usageError(`--verify 不支持的参数：${arg}`)
  }
  return out
}

function parseUnpublishArgs(appName, rest) {
  const out = { kind: 'unpublish', appName, dryRun: false }
  for (const arg of rest) {
    if (arg !== '--dry-run') throw usageError(`--unpublish 不支持的参数：${arg}`)
    out.dryRun = true
  }
  return out
}

function parseRegisterArgs(appName, rest) {
  if (rest.length !== 1 || String(rest[0]).trim() === '') {
    throw usageError('--register 需要且只需要一个应用根目录绝对路径')
  }
  return { kind: 'register', appName, appDir: String(rest[0]).trim() }
}

const appCommandParsers = {
  '--verify': parseVerifyArgs,
  '--unpublish': parseUnpublishArgs,
  '--register': parseRegisterArgs,
}

export function parseArgs(argv) {
  const args = argv.slice(2)
  if (args.length === 0) throw usageError()
  if (args[0].startsWith('--')) return parseGlobalArgs(args)
  if (args.length < 2) throw usageError()
  const [appName, command, ...rest] = args
  const parser = appCommandParsers[command]
  if (parser) return parser(appName, rest)
  if (command.startsWith('--')) throw usageError(`不支持的应用命令：${command}`)
  return parseActionArgs(appName, [command, ...rest])
}
