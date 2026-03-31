import fs from 'node:fs'
import path from 'node:path'

function die(message) {
  console.error(message)
  process.exit(1)
}

function parseArgs(argv) {
  let bump = 'patch'
  let to = null
  let dryRun = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run' || arg === '--dry') {
      dryRun = true
      continue
    }
    if (arg === '--patch') {
      bump = 'patch'
      continue
    }
    if (arg === '--minor') {
      bump = 'minor'
      continue
    }
    if (arg === '--major') {
      bump = 'major'
      continue
    }
    if (arg === '--to') {
      to = argv[i + 1]
      i++
      continue
    }
    if (arg === '-h' || arg === '--help') {
      console.log(
        [
          'Usage:',
          '  node scripts/bump-host-version.mjs            # bump patch',
          '  node scripts/bump-host-version.mjs --minor    # bump minor',
          '  node scripts/bump-host-version.mjs --major    # bump major',
          '  node scripts/bump-host-version.mjs --to 0.6.3 # set explicit',
          '  node scripts/bump-host-version.mjs --dry-run  # preview only',
        ].join('\n'),
      )
      process.exit(0)
    }
    die(`Unknown arg: ${arg}`)
  }

  return { bump, to, dryRun }
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) die(`Unsupported version format: ${version}`)
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function bumpSemver(version, bump) {
  const v = parseSemver(version)
  if (bump === 'patch') return `${v.major}.${v.minor}.${v.patch + 1}`
  if (bump === 'minor') return `${v.major}.${v.minor + 1}.0`
  if (bump === 'major') return `${v.major + 1}.0.0`
  die(`Unknown bump: ${bump}`)
}

function preserveNewline(text, updatedText) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  return updatedText.replace(/\n/g, newline)
}

function updateJsonTopLevelVersion(text, newVersion, fileLabel) {
  const updated = text.replace(
    /"version"(\s*:\s*)"[^"]*"/,
    `"version"$1"${newVersion}"`,
  )
  if (updated === text) die(`${fileLabel}: cannot find "version" field`)
  return updated
}

function updateCargoTomlPackageVersion(text, newVersion) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)

  const packageIndex = lines.findIndex((l) => l.trim() === '[package]')
  if (packageIndex === -1) die('Cargo.toml: cannot find [package] section')

  let versionLineIndex = -1
  for (let i = packageIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim().startsWith('[')) break
    if (line.trim().startsWith('version =')) {
      versionLineIndex = i
      break
    }
  }
  if (versionLineIndex === -1)
    die('Cargo.toml: cannot find package version line')

  lines[versionLineIndex] = lines[versionLineIndex].replace(
    /(version\s*=\s*)".*?"/,
    `$1"${newVersion}"`,
  )

  return lines.join(newline)
}

function readCargoPackageName(cargoTomlText) {
  const lines = cargoTomlText.split(/\r?\n/)
  const packageIndex = lines.findIndex((l) => l.trim() === '[package]')
  if (packageIndex === -1) return null
  for (let i = packageIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim().startsWith('[')) break
    const match = /^\s*name\s*=\s*"([^"]+)"\s*$/.exec(line)
    if (match) return match[1]
  }
  return null
}

function updateCargoLockPackageVersion(text, packageName, newVersion) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)

  let nameIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === `name = "${packageName}"`) {
      nameIndex = i
      break
    }
  }
  if (nameIndex === -1)
    die(`Cargo.lock: cannot find package name: ${packageName}`)

  let versionLineIndex = -1
  for (let i = nameIndex + 1; i < Math.min(nameIndex + 30, lines.length); i++) {
    if (lines[i].trim().startsWith('name = "')) break
    if (lines[i].trim().startsWith('version = "')) {
      versionLineIndex = i
      break
    }
  }
  if (versionLineIndex === -1)
    die(`Cargo.lock: cannot find version for package: ${packageName}`)

  lines[versionLineIndex] = lines[versionLineIndex].replace(
    /(version\s*=\s*)".*?"/,
    `$1"${newVersion}"`,
  )

  return lines.join(newline)
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function writeText(filePath, text) {
  fs.writeFileSync(filePath, text, 'utf8')
}

const { bump, to, dryRun } = parseArgs(process.argv.slice(2))

const repoRoot = process.cwd()
const packageJsonPath = path.join(repoRoot, 'package.json')
const cargoTomlPath = path.join(repoRoot, 'src-tauri', 'Cargo.toml')
const cargoLockPath = path.join(repoRoot, 'src-tauri', 'Cargo.lock')
const tauriConfPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json')

for (const p of [packageJsonPath, cargoTomlPath, cargoLockPath, tauriConfPath]) {
  if (!fs.existsSync(p)) die(`Missing file: ${p}`)
}

const packageJsonText = readText(packageJsonPath)
let pkg
try {
  pkg = JSON.parse(packageJsonText)
} catch (e) {
  die(`package.json: invalid JSON: ${e?.message ?? String(e)}`)
}
if (!pkg?.version) die('package.json: missing version')

const cargoTomlText = readText(cargoTomlPath)
const cargoPackageName = readCargoPackageName(cargoTomlText)
const packageName = cargoPackageName ?? pkg.name
if (!packageName) die('Cannot determine package name (Cargo.toml or package.json)')

const oldVersion = String(pkg.version)
const newVersion = to ?? bumpSemver(oldVersion, bump)
parseSemver(newVersion)

if (newVersion === oldVersion) die('New version equals old version; nothing to do')

const updates = [
  {
    label: 'package.json',
    filePath: packageJsonPath,
    update: (text) => updateJsonTopLevelVersion(text, newVersion, 'package.json'),
  },
  {
    label: 'src-tauri/Cargo.toml',
    filePath: cargoTomlPath,
    update: (text) => updateCargoTomlPackageVersion(text, newVersion),
  },
  {
    label: 'src-tauri/tauri.conf.json',
    filePath: tauriConfPath,
    update: (text) =>
      updateJsonTopLevelVersion(text, newVersion, 'tauri.conf.json'),
  },
  {
    label: 'src-tauri/Cargo.lock',
    filePath: cargoLockPath,
    update: (text) => updateCargoLockPackageVersion(text, packageName, newVersion),
  },
]

const changed = []
for (const u of updates) {
  const before = readText(u.filePath)
  let after = u.update(before)
  after = preserveNewline(before, after)
  if (after !== before) {
    changed.push(u.label)
    if (!dryRun) writeText(u.filePath, after)
  }
}

const mode = dryRun ? 'DRY-RUN' : 'APPLIED'
console.log(`[${mode}] ${oldVersion} -> ${newVersion}`)
console.log(`[${mode}] files: ${changed.length ? changed.join(', ') : '(none)'}`)
