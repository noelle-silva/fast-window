export const HOST_TAURI_BUILD_CHANNEL_ENV = 'FAST_WINDOW_HOST_TAURI_BUILD_CHANNEL'
export const HOST_TAURI_BUILD_CHANNEL_MANAGED = 'managed-host-msi'
export const HOST_PROFILE_ENV = 'FAST_WINDOW_HOST_PROFILE'
export const HOST_VITE_PROFILE_ENV = 'VITE_FAST_WINDOW_HOST_PROFILE'
export const TAURI_CONFIG_ENV = 'TAURI_CONFIG'
export const HOST_PROFILE_DEV = 'dev'
export const HOST_PROFILE_RELEASE = 'release'

export function hostDevProfileEnv(env = process.env) {
  return withHostProfileEnv(env, HOST_PROFILE_DEV)
}

export function hostReleaseProfileEnv(env = process.env) {
  return withHostProfileEnv(env, HOST_PROFILE_RELEASE)
}

export function managedHostTauriBuildEnv(env = process.env) {
  const next = {
    ...hostReleaseProfileEnv(env),
    [HOST_TAURI_BUILD_CHANNEL_ENV]: HOST_TAURI_BUILD_CHANNEL_MANAGED,
  }
  delete next[TAURI_CONFIG_ENV]
  return next
}

export function assertHostTauriBuildAllowed(args, env = process.env) {
  if (!isTauriBuild(args)) return
  if (isHelpRequest(args)) return
  if (isManagedHostBuild(env)) {
    assertReleaseHostProfile(env)
    return
  }
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

function withHostProfileEnv(env, profile) {
  return {
    ...env,
    [HOST_PROFILE_ENV]: profile,
    [HOST_VITE_PROFILE_ENV]: profile,
  }
}

function assertReleaseHostProfile(env) {
  const hostProfile = String(env?.[HOST_PROFILE_ENV] || '').trim()
  const viteProfile = String(env?.[HOST_VITE_PROFILE_ENV] || '').trim()
  const tauriConfig = String(env?.[TAURI_CONFIG_ENV] || '').trim()
  if (hostProfile !== HOST_PROFILE_RELEASE || viteProfile !== HOST_PROFILE_RELEASE) {
    throw new Error([
      '宿主发布构建环境必须显式使用 release profile。',
      `当前 ${HOST_PROFILE_ENV}=${hostProfile || '(empty)'}`,
      `当前 ${HOST_VITE_PROFILE_ENV}=${viteProfile || '(empty)'}`,
      '原因：发布构建不能继承 dev 宿主运行环境，否则会产出 dev 安装包。',
    ].join('\n'))
  }
  if (tauriConfig) {
    throw new Error([
      `宿主发布构建环境不允许携带 ${TAURI_CONFIG_ENV}。`,
      '原因：TAURI_CONFIG 会覆盖 tauri.conf.json，可能把 dev productName/identifier 写进发布包。',
    ].join('\n'))
  }
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
