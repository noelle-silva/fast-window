import process from 'node:process'
import { githubJson, repoApiBase } from './v5-download-store.mjs'

export const HOST_RELEASE_TOKEN_ENV = 'FAST_WINDOW_HOST_RELEASE_GITHUB_TOKEN'
export const DISTRIBUTION_TOKEN_ENV = 'FAST_WINDOW_GITHUB_TOKEN'

export function hostPublishTokenUsageLines() {
  return [
    'Token 要求：',
    `  ${HOST_RELEASE_TOKEN_ENV}  必填；写入宿主主仓 Release，用于上传 MSI`,
    `  ${DISTRIBUTION_TOKEN_ENV}  必填；写入分发仓 catalog.json 元数据`,
    '  两个 Token 必须分别授权各自仓库，不允许复用同一个值',
  ]
}

export async function resolveHostPublishTokens({ releaseOpts, catalogOpts, dryRun }) {
  const releaseToken = envToken(HOST_RELEASE_TOKEN_ENV)
  const catalogToken = envToken(DISTRIBUTION_TOKEN_ENV)

  if (dryRun) {
    return { releaseToken, catalogToken }
  }

  if (!releaseToken) {
    throw new Error(`缺少宿主 MSI 发布 Token：请设置 ${HOST_RELEASE_TOKEN_ENV}。该 Token 只用于写入 ${releaseOpts.owner}/${releaseOpts.repo} 的 Release。`)
  }
  if (!catalogToken) {
    throw new Error(`缺少分发仓发布 Token：请设置 ${DISTRIBUTION_TOKEN_ENV}。该 Token 用于写入 ${catalogOpts.owner}/${catalogOpts.repo} 的 catalog.json。`)
  }
  if (releaseToken === catalogToken) {
    throw new Error(`${HOST_RELEASE_TOKEN_ENV} 与 ${DISTRIBUTION_TOKEN_ENV} 不能使用同一个 Token。两个真实仓库必须使用两把职责独立的钥匙。`)
  }

  await assertHostPublishRepositoryWriteAccess({
    opts: releaseOpts,
    token: releaseToken,
    envName: HOST_RELEASE_TOKEN_ENV,
    role: '宿主 MSI Release 发布',
  })
  await assertHostPublishRepositoryWriteAccess({
    opts: catalogOpts,
    token: catalogToken,
    envName: DISTRIBUTION_TOKEN_ENV,
    role: '分发仓 catalog.json 元数据写入',
  })
  await assertCatalogBranchExists({ opts: catalogOpts, token: catalogToken, envName: DISTRIBUTION_TOKEN_ENV })
  return { releaseToken, catalogToken }
}

async function assertHostPublishRepositoryWriteAccess({ opts, token, envName, role }) {
  let repo = null
  try {
    repo = await githubJson('GET', repoApiBase(opts), token)
  } catch (error) {
    const status = Number(error?.status || 0)
    if (status === 401) {
      throw new Error(`${role} Token 校验失败：${envName} 无效、已过期，或没有被当前终端/.env 正确加载。目标仓库：${opts.owner}/${opts.repo}。`)
    }
    if (status === 403) {
      throw new Error(`${role} Token 权限不足：请确认 ${envName} 对 ${opts.owner}/${opts.repo} 具备 Contents = Read and write 权限。`)
    }
    if (status === 404) {
      throw new Error(`${role} Token 无法访问目标仓库：请确认 ${envName} 已授权仓库 ${opts.owner}/${opts.repo}。`)
    }
    throw new Error(`${role} Token 校验失败：请检查 ${envName} 与仓库 ${opts.owner}/${opts.repo}。错误：${error?.message || error}`)
  }
  assertRepositoryWritePermission(repo, { envName, role, repository: `${opts.owner}/${opts.repo}` })
}

async function assertCatalogBranchExists({ opts, token, envName }) {
  try {
    await githubJson('GET', `${repoApiBase(opts)}/branches/${encodeURIComponent(opts.branch)}`, token)
  } catch (error) {
    const status = Number(error?.status || 0)
    if (status === 404) throw new Error(`分发仓 catalog 分支不存在或不可访问：${opts.owner}/${opts.repo}@${opts.branch}。请检查 ${envName} 的仓库授权与 --catalog-branch。`)
    throw new Error(`分发仓 catalog 分支校验失败：${opts.owner}/${opts.repo}@${opts.branch}。错误：${error?.message || error}`)
  }
}

function assertRepositoryWritePermission(repo, { envName, role, repository }) {
  const permissions = repo?.permissions
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
    throw new Error(`${role} Token 权限无法确认：GitHub 未返回 ${repository} 的 permissions 字段。请使用能返回仓库权限的 Token，并确保 ${envName} 对目标仓库具备 Contents = Read and write。`)
  }
  if (permissions.admin === true || permissions.maintain === true || permissions.push === true) return
  throw new Error(`${role} Token 权限不足：${envName} 对 ${repository} 没有写权限。请确认该 Token 对目标仓库具备 Contents = Read and write。`)
}

function envToken(name) {
  return String(process.env[name] || '').trim()
}
