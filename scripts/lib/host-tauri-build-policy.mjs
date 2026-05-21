export const HOST_TAURI_BUILD_CHANNEL_ENV = 'FAST_WINDOW_HOST_TAURI_BUILD_CHANNEL'
export const HOST_TAURI_BUILD_CHANNEL_MANAGED = 'managed-host-msi'

export function managedHostTauriBuildEnv(env = process.env) {
  return {
    ...env,
    [HOST_TAURI_BUILD_CHANNEL_ENV]: HOST_TAURI_BUILD_CHANNEL_MANAGED,
  }
}

export function assertHostTauriBuildAllowed(args, env = process.env) {
  if (!isTauriBuild(args)) return
  if (isHelpRequest(args)) return
  if (isManagedHostBuild(env)) return
  throw new Error([
    '禁止直接使用底层 Tauri build 构建宿主发布包。',
    '',
    '请改用显式版本声明命令：',
    '  pnpm run host:build:msi -- --keep-version',
    '  pnpm run host:build:msi -- --bump patch',
    '  pnpm run host:build:msi -- --version 1.7.1',
    '',
    '发布到下载仓库请使用：',
    '  pnpm run host:publish -- --bump patch',
    '  pnpm run host:publish -- --version 1.7.1',
    '',
    '原因：宿主 MSI 必须走统一版本声明、产物命名、hash 校验与发布清单机制。',
  ].join('\n'))
}

function isTauriBuild(args) {
  return String(args?.[0] || '').trim() === 'build'
}

function isHelpRequest(args) {
  return args.some(arg => arg === '-h' || arg === '--help')
}

function isManagedHostBuild(env) {
  return String(env?.[HOST_TAURI_BUILD_CHANNEL_ENV] || '').trim() === HOST_TAURI_BUILD_CHANNEL_MANAGED
}
