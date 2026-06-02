import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..')
const vendorDir = path.join(appDir, 'vendor', 'everything', 'windows-x64')
const manifestPath = path.join(vendorDir, 'vendor-manifest.json')
const requiredFiles = new Set(['Everything.exe', 'es.exe', 'License.txt', 'THIRD_PARTY_NOTICES.md'])

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fssync.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function normalizeRel(raw, field) {
  const rel = String(raw || '').trim().replaceAll('\\', '/')
  if (!rel || rel.includes('/') || rel === '.' || rel === '..') throw new Error(`${field} must be a vendor file name`)
  return rel
}

async function main() {
  if (!(await exists(manifestPath))) {
    throw new Error(`Missing Everything vendor manifest: ${manifestPath}`)
  }
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 1) throw new Error('vendor-manifest.json schemaVersion must be 1')
  if (manifest.name !== 'Everything') throw new Error('vendor-manifest.json name must be Everything')
  if (manifest.architecture !== 'windows-x64') throw new Error('vendor-manifest.json architecture must be windows-x64')
  if (!Array.isArray(manifest.files)) throw new Error('vendor-manifest.json files must be an array')

  const seen = new Set()
  for (const file of manifest.files) {
    const rel = normalizeRel(file.path, 'files[].path')
    const expected = String(file.sha256 || '').trim().toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error(`Invalid sha256 for ${rel}`)
    const actual = await sha256File(path.join(vendorDir, rel))
    if (actual !== expected) throw new Error(`Everything vendor sha256 mismatch for ${rel}: expected ${expected}, actual ${actual}`)
    seen.add(rel)
  }

  for (const rel of requiredFiles) {
    if (!seen.has(rel)) throw new Error(`vendor-manifest.json must include ${rel}`)
  }
}

main().catch(error => {
  process.stderr.write(`[everything-vendor] ${String(error?.message || error)}\n`)
  process.exit(1)
})
