import process from 'node:process'
import { scriptArgs } from './lib/v5-cli-args.mjs'
import {
  bumpV5AppVersion,
  checkV5AppVersion,
  inferV5AppIdFromCwd,
  rootDir,
} from './lib/v5-app-versioning.mjs'

function die(message) {
  console.error(message)
  process.exit(1)
}

function usage() {
  console.log([
    'Usage:',
    '  node scripts/bump-v5-app-version.mjs --app <id>            # bump patch',
    '  node scripts/bump-v5-app-version.mjs --app <id> --minor    # bump minor',
    '  node scripts/bump-v5-app-version.mjs --app <id> --major    # bump major',
    '  node scripts/bump-v5-app-version.mjs --app <id> --to 0.2.0 # set explicit',
    '  node scripts/bump-v5-app-version.mjs --app <id> --dry-run  # preview only',
    '  node scripts/bump-v5-app-version.mjs --app <id> --check    # verify only',
  ].join('\n'))
}

function parseArgs(argv) {
  const out = {
    appId: '',
    bump: 'patch',
    explicitBump: false,
    to: null,
    dryRun: false,
    check: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      usage()
      process.exit(0)
    }
    if (arg === '--app') {
      out.appId = String(argv[++i] || '').trim()
      if (!out.appId) die('--app 不能为空')
      continue
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
  if (!out.appId) out.appId = inferV5AppIdFromCwd(process.cwd(), rootDir)
  if (!out.appId) die('无法确定 v5 app id，请使用 --app <id>，或在 apps/<id> 目录内执行')
  return out
}

function printResult(prefix, result) {
  console.log(`${prefix} ${result.appId} ${result.oldVersion || result.currentVersion}${result.newVersion ? ` -> ${result.newVersion}` : ''}`)
  if (result.cargoPackageName) console.log(`${prefix} cargo package: ${result.cargoPackageName}`)
  const files = result.files || []
  if (files.length) {
    console.log(`${prefix} files:`)
    for (const file of files) console.log(`  ${typeof file === 'string' ? file : `${file.label} @ ${file.version}`}`)
  }
}

async function main() {
  const opts = parseArgs(scriptArgs(process.argv))
  if (opts.check) {
    const result = await checkV5AppVersion(opts.appId)
    printResult('[CHECK]', result)
    return
  }

  const result = await bumpV5AppVersion({
    appId: opts.appId,
    bump: opts.bump,
    to: opts.to,
    dryRun: opts.dryRun,
  })
  printResult(opts.dryRun ? '[DRY-RUN]' : '[APPLIED]', result)
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
