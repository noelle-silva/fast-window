import process from 'node:process'
import { scriptArgs } from './lib/v5-cli-args.mjs'
import {
  applyHostVersionPlan,
  consumeHostVersionArg,
  defaultHostVersionDeclaration,
  hostVersionUsageLines,
  resolveHostVersionPlan,
} from './lib/host-versioning.mjs'

function usage() {
  console.log([
    'Usage:',
    '  node scripts/bump-host-version.mjs --bump patch [--dry-run]',
    '  node scripts/bump-host-version.mjs --bump minor [--dry-run]',
    '  node scripts/bump-host-version.mjs --bump major [--dry-run]',
    '  node scripts/bump-host-version.mjs --version 1.6.12 [--dry-run]',
    '',
    ...hostVersionUsageLines({ allowKeep: false }),
  ].join('\n'))
}

function parseArgs(argv) {
  const out = { dryRun: false, versionDeclaration: defaultHostVersionDeclaration() }
  const args = scriptArgs(argv)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-h' || arg === '--help') {
      usage()
      process.exit(0)
    }
    if (arg === '--dry-run' || arg === '--dry') out.dryRun = true
    else {
      const nextIndex = consumeHostVersionArg(out.versionDeclaration, args, i)
      if (nextIndex >= 0) i = nextIndex
      else throw new Error(`未知参数: ${arg}`)
    }
  }
  return out
}

async function main() {
  const opts = parseArgs(process.argv)
  const plan = await resolveHostVersionPlan(opts.versionDeclaration, { allowKeep: false, commandName: 'host:bump' })
  const result = await applyHostVersionPlan(plan, { dryRun: opts.dryRun })
  console.log(JSON.stringify({ action: 'host-version', ...result }, null, 2))
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
