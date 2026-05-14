import path from 'node:path'
import process from 'node:process'
import { scriptArgs } from './lib/v5-cli-args.mjs'
import { isSafeId, rootDir } from './lib/v5-app-packaging.mjs'
import { bumpV5AppVersion, checkV5AppVersion, inferV5AppIdFromCwd } from './lib/v5-app-versioning.mjs'
import { defaultV5AppPublishOptions, planV5AppPublishToDownload, publishV5AppToDownload } from './lib/v5-app-publishing.mjs'

const BUMP_TYPES = new Set(['patch', 'minor', 'major'])

function usage() {
  console.log([
    'Usage:',
    '  node scripts/release-v5-app.mjs --app <id> --bump patch|minor|major [--dry-run] [--no-build]',
    '  node scripts/release-v5-app.mjs --app <id> --to x.y.z [--dry-run] [--no-build]',
    '  node ../../scripts/release-v5-app.mjs --bump patch [--dry-run] [--no-build]   # from apps/<id>',
  ].join('\n'))
}

function parseArgs(argv) {
  const out = {
    ...defaultV5AppPublishOptions(),
    appId: '',
    bump: '',
    to: null,
  }
  const args = scriptArgs(argv)
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '-h' || arg === '--help') {
      usage()
      process.exit(0)
    }
    if (arg === '--app' && i + 1 < args.length) {
      out.appId = String(args[++i] || '').trim()
      continue
    }
    if (arg === '--bump' && i + 1 < args.length) {
      out.bump = String(args[++i] || '').trim()
      continue
    }
    if (arg === '--to' && i + 1 < args.length) {
      out.to = String(args[++i] || '').trim()
      continue
    }
    if (arg === '--owner' && i + 1 < args.length) {
      out.owner = String(args[++i] || '').trim() || out.owner
      continue
    }
    if (arg === '--repo' && i + 1 < args.length) {
      out.repo = String(args[++i] || '').trim() || out.repo
      continue
    }
    if (arg === '--branch' && i + 1 < args.length) {
      out.branch = String(args[++i] || '').trim() || out.branch
      continue
    }
    if (arg === '--out' && i + 1 < args.length) {
      out.outDir = path.resolve(rootDir, String(args[++i] || '').trim())
      continue
    }
    if (arg === '--message' && i + 1 < args.length) {
      out.message = String(args[++i] || '').trim() || out.message
      continue
    }
    if (arg === '--no-build') {
      out.noBuild = true
      continue
    }
    if (arg === '--dry-run') {
      out.dryRun = true
      continue
    }
    throw new Error(`未知参数: ${arg}`)
  }

  if (!out.appId) out.appId = inferV5AppIdFromCwd(process.cwd(), rootDir)
  if (!out.appId) throw new Error('无法确定 v5 app id，请使用 --app <id>，或在 apps/<id> 目录内执行')
  if (!isSafeId(out.appId)) throw new Error(`app id 不合法: ${out.appId}`)
  if (out.bump && out.to) throw new Error('--bump 不能和 --to 同时使用')
  if (!out.bump && !out.to) throw new Error('release 必须显式声明升版策略：请传 --bump patch|minor|major 或 --to x.y.z')
  if (out.bump && !BUMP_TYPES.has(out.bump)) throw new Error(`--bump 只支持 patch、minor、major: ${out.bump}`)
  return out
}

function publishOptions(opts) {
  const { bump, to, ...publish } = opts
  return publish
}

async function dryRunRelease(opts) {
  const before = await checkV5AppVersion(opts.appId)
  const bump = await bumpV5AppVersion({
    appId: opts.appId,
    bump: opts.bump || 'patch',
    to: opts.to,
    dryRun: true,
  })
  const publishPlan = await planV5AppPublishToDownload({ ...publishOptions(opts), version: bump.newVersion })
  return {
    dryRun: true,
    appId: opts.appId,
    releasePolicy: opts.to ? { type: 'to', version: opts.to } : { type: 'bump', bump: opts.bump },
    currentVersion: before.currentVersion,
    nextVersion: bump.newVersion,
    publishPlan,
    files: bump.files,
    note: 'dry-run 只预演版本变更；正式 release 会先写入版本并校验，再执行发布。',
  }
}

async function runRelease(opts) {
  const plan = await bumpV5AppVersion({
    appId: opts.appId,
    bump: opts.bump || 'patch',
    to: opts.to,
    dryRun: true,
  })
  await planV5AppPublishToDownload({ ...publishOptions(opts), version: plan.newVersion })

  const bump = await bumpV5AppVersion({
    appId: opts.appId,
    bump: opts.bump || 'patch',
    to: opts.to,
    dryRun: false,
  })
  try {
    const verified = await checkV5AppVersion(opts.appId)
    if (verified.currentVersion !== bump.newVersion) throw new Error(`release 升版校验失败: expected=${bump.newVersion}, got=${verified.currentVersion}`)
    const published = await publishV5AppToDownload(publishOptions(opts))
    return {
      appId: opts.appId,
      releasePolicy: opts.to ? { type: 'to', version: opts.to } : { type: 'bump', bump: opts.bump },
      version: bump.newVersion,
      versionFiles: bump.files,
      published,
    }
  } catch (error) {
    try {
      await bumpV5AppVersion({ appId: opts.appId, to: bump.oldVersion, dryRun: false })
    } catch (rollbackError) {
      throw new Error(`release 发布失败，且版本回滚失败；当前可能停留在 ${bump.newVersion}。发布错误: ${error?.message || error}；回滚错误: ${rollbackError?.message || rollbackError}`)
    }
    throw new Error(`release 发布失败，版本已回滚到 ${bump.oldVersion}: ${error?.message || error}`)
  }
}

async function main() {
  const opts = parseArgs(process.argv)
  const result = opts.dryRun ? await dryRunRelease(opts) : await runRelease(opts)
  console.log(JSON.stringify(result, null, 2))
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
