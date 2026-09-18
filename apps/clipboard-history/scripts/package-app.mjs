import path from 'node:path'
import process from 'node:process'
import { scriptArgs } from './lib/v5-cli-args.mjs'
import { buildV5AppPackage, loadAppConfig, rootDir } from './lib/v5-app-packaging.mjs'

const usageLine = [
  '用法：node scripts/package-app.mjs [--no-build] [--out <dir>]',
  '说明：装配 release 基础成品包（zip）；商店化由协议工具在协议目录 dist/ 完成。',
].join('\n')

function parseArgs(argv) {
  const out = { noBuild: false, outDir: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      console.log(usageLine)
      process.exit(0)
    }
    if (arg === '--out' && i + 1 < argv.length) {
      const outDir = String(argv[++i] || '').trim()
      if (!outDir) throw new Error('--out 不能为空')
      out.outDir = path.resolve(rootDir, outDir)
      continue
    }
    if (arg === '--no-build') {
      out.noBuild = true
      continue
    }
    throw new Error(`未知参数: ${arg}`)
  }
  return out
}

async function main() {
  const opts = parseArgs(scriptArgs(process.argv))
  const config = await loadAppConfig()
  const result = await buildV5AppPackage(config, {
    noBuild: opts.noBuild,
    ...(opts.outDir ? { outDir: opts.outDir } : {}),
  })
  console.log(JSON.stringify({
    appId: result.appId,
    version: result.version,
    zipName: result.zipName,
    zipPath: result.zipPath,
    sha256: result.sha256,
    sizeBytes: result.sizeBytes,
    stageDir: result.stageDir,
  }))
}

await main().catch(error => {
  process.stderr.write(`${String(error?.message || error)}\n`)
  process.exitCode = 1
})
