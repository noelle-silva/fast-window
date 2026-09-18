import process from 'node:process'
import { scriptArgs } from './lib/v5-cli-args.mjs'
import { bumpV5AppVersion, checkV5AppVersion } from './lib/v5-app-versioning.mjs'

const BUMP_TYPES = new Set(['patch', 'minor', 'major'])

function die(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function usage() {
  console.log([
    '用法：',
    '  node scripts/bump-app-version.mjs            # bump patch',
    '  node scripts/bump-app-version.mjs --minor    # bump minor',
    '  node scripts/bump-app-version.mjs --major    # bump major',
    '  node scripts/bump-app-version.mjs --to 0.2.0 # 指定版本',
    '  node scripts/bump-app-version.mjs --dry-run  # 只预演',
    '  node scripts/bump-app-version.mjs --check    # 只校验一致性',
  ].join('\n'))
}

function parseArgs(argv) {
  const out = { bump: 'patch', explicitBump: false, to: null, dryRun: false, check: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      usage()
      process.exit(0)
    }
    if (arg === '--patch' || arg === '--minor' || arg === '--major') {
      if (out.explicitBump) die('只能指定一种升版类型')
      out.bump = arg.slice(2)
      out.explicitBump = true
      continue
    }
    if (arg === '--to') {
      out.to = String(argv[++i] || '').trim()
      if (!out.to) die('--to 不能为空')
      continue
    }
    if (arg === '--dry-run' || arg === '--dry') {
      out.dryRun = true
      continue
    }
    if (arg === '--check') {
      out.check = true
      continue
    }
    die(`未知参数: ${arg}`)
  }
  if (out.to && out.explicitBump) die('--to 不能和 --patch/--minor/--major 同时使用')
  if (out.check && (out.to || out.explicitBump || out.dryRun)) die('--check 只能单独用于一致性校验')
  return out
}

async function main() {
  const opts = parseArgs(scriptArgs(process.argv))
  if (opts.check) {
    console.log(JSON.stringify(await checkV5AppVersion()))
    return
  }
  const result = await bumpV5AppVersion({
    bump: opts.bump,
    to: opts.to,
    dryRun: opts.dryRun,
  })
  console.log(JSON.stringify({
    oldVersion: result.oldVersion,
    newVersion: result.newVersion,
    dryRun: result.dryRun,
    cargoPackageName: result.cargoPackageName,
    files: result.files,
  }))
}

await main().catch(error => {
  process.stderr.write(`${String(error?.message || error)}\n`)
  process.exitCode = 1
})
