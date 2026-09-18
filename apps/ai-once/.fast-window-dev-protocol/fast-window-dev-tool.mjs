import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

const protocolFileName = 'fast-window-dev-protocol.json'
const receiptPrefix = 'FAST-WINDOW-DEV-RECEIPT: '
const contractVersion = 1
const statusSucceeded = 'succeeded'
const statusFailed = 'failed'

const sourceManifestFileName = 'fw-app.json'
const storeManifestFileName = 'fw-app.json'
const storePackageDirName = 'dist'
const storeIconDirName = 'assets'
const appTypeDesktopApp = 'desktop-app'
const appTypeServiceApp = 'service-app'

const zipEndOfCentralDirectorySignature = 0x06054b50
const zipCentralDirectorySignature = 0x02014b50
const zipLocalHeaderSignature = 0x04034b50
const zipUTF8Flag = 0x0800
const zipMethodStore = 0
const zipMethodDeflate = 8

const toolDir = path.dirname(fileURLToPath(import.meta.url))
const protocolFile = path.join(toolDir, protocolFileName)
const usageLine = '用法：node fast-window-dev-tool.mjs <动作代号>'

const crc32Table = buildCrc32Table()

function buildCrc32Table() {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

function crc32(buffer) {
  let checksum = 0xffffffff
  for (const byte of buffer) {
    checksum = crc32Table[(checksum ^ byte) & 0xff] ^ (checksum >>> 8)
  }
  return (checksum ^ 0xffffffff) >>> 0
}

function failureReceipt(action, cause) {
  return {
    contractVersion,
    action,
    status: statusFailed,
    exitCode: null,
    error: cause instanceof Error ? cause.message : String(cause),
    data: { result: null, artifact: {} },
  }
}

function readProtocol(file) {
  if (!existsSync(file)) {
    throw new Error(`找不到协议文件：${protocolFileName}`)
  }
  let payload
  try {
    payload = readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error(`读取协议文件失败：${error.message}`)
  }
  let parsed
  try {
    parsed = JSON.parse(payload)
  } catch (error) {
    throw new Error(`解析协议文件失败：${error.message}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('解析协议文件失败：顶层必须是 JSON 对象')
  }
  return { actions: parseActions(parsed.actions) }
}

function parseActions(raw) {
  if (raw === undefined || raw === null) {
    return {}
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('解析协议文件失败：actions 必须是 JSON 对象')
  }
  const actions = {}
  for (const [name, value] of Object.entries(raw)) {
    actions[name] = parseActionDefinition(name, value)
  }
  return actions
}

function parseActionDefinition(name, value) {
  if (typeof value === 'string') {
    return { command: value, artifact: {}, storePackage: false }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`解析协议文件失败：动作 ${name} 必须是命令字符串或对象`)
  }
  if (value.command !== undefined && typeof value.command !== 'string') {
    throw new Error(`解析协议文件失败：动作 ${name} 的 command 必须是字符串`)
  }
  if (value.storePackage !== undefined && typeof value.storePackage !== 'boolean') {
    throw new Error(`解析协议文件失败：动作 ${name} 的 storePackage 必须是布尔值`)
  }
  const artifact = {}
  if (value.artifact !== undefined && value.artifact !== null) {
    if (typeof value.artifact !== 'object' || Array.isArray(value.artifact)) {
      throw new Error(`解析协议文件失败：动作 ${name} 的 artifact 必须是对象`)
    }
    for (const [field, sourcePath] of Object.entries(value.artifact)) {
      if (typeof sourcePath !== 'string') {
        throw new Error(`解析协议文件失败：动作 ${name} 的 artifact.${field} 必须是字符串路径`)
      }
      artifact[field] = sourcePath
    }
  }
  return { command: value.command ?? '', artifact, storePackage: value.storePackage === true }
}

async function executeAction(args) {
  if (args.length !== 1) {
    return failureReceipt('', new Error(usageLine))
  }
  const action = args[0].trim()
  let definition
  try {
    const protocol = readProtocol(protocolFile)
    definition = protocol.actions[action]
    if (definition === undefined) {
      const names = Object.keys(protocol.actions).sort().join(', ')
      throw new Error(`协议未定义动作 ${JSON.stringify(action)}（可用动作：${names}）`)
    }
    if (definition.command.trim() === '') {
      throw new Error(`协议动作 ${JSON.stringify(action)} 的命令为空`)
    }
  } catch (error) {
    return failureReceipt(action, error)
  }

  let exitCode
  let result
  let artifact
  try {
    const executed = await runShellCommand(definition.command, toolDir)
    exitCode = executed.exitCode
    result = parseJsonOutput(executed.stdout)
    artifact = extractArtifact(definition.artifact, result)
  } catch (error) {
    return failureReceipt(action, error)
  }

  if (definition.storePackage && exitCode === 0) {
    try {
      artifact = buildStorePackage(toolDir, artifact)
    } catch (error) {
      return failureReceipt(action, error)
    }
  }

  return {
    contractVersion,
    action,
    status: exitCode === 0 ? statusSucceeded : statusFailed,
    exitCode,
    error: '',
    data: { result, artifact },
  }
}

function runShellCommand(source, cwd) {
  const isWindows = process.platform === 'win32'
  let scriptPath = ''
  let command = 'sh'
  let commandArgs = ['-c', source]
  if (isWindows) {
    // Windows 下命令原文写入临时脚本再执行，避免命令行参数转义破坏引号等 shell 语法。
    scriptPath = path.join(tmpdir(), `fast-window-dev-command-${randomUUID()}.cmd`)
    writeFileSync(scriptPath, `@echo off\r\n${source}\r\n`, 'utf8')
    command = 'cmd'
    commandArgs = ['/c', scriptPath]
  }
  const cleanup = () => {
    if (scriptPath !== '') {
      try {
        rmSync(scriptPath, { force: true })
      } catch {
        // 临时脚本清理失败不影响回执。
      }
    }
  }
  return new Promise((resolve, reject) => {
    let stdout = ''
    let settled = false
    const child = spawn(command, commandArgs, { cwd, stdio: ['inherit', 'pipe', 'pipe'] })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', chunk => process.stderr.write(chunk))
    child.on('error', error => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(new Error(`执行动作失败：${error.message}`))
    })
    child.on('close', code => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      // 回执必须独占一行，命令输出末尾缺换行时补一个。
      if (stdout !== '' && !stdout.endsWith('\n')) {
        process.stdout.write('\n')
      }
      resolve({ exitCode: code ?? -1, stdout })
    })
  })
}

function parseJsonOutput(text) {
  const trimmed = text.trim()
  if (trimmed === '') {
    return null
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function extractArtifact(declaration, result) {
  const artifact = {}
  for (const [field, sourcePath] of Object.entries(declaration)) {
    const value = valueAtPath(result, sourcePath)
    if (typeof value === 'string') {
      artifact[field] = value
    }
  }
  return artifact
}

function valueAtPath(root, dotted) {
  let current = root
  for (const segment of dotted.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }
    if (!Object.hasOwn(current, segment)) {
      return undefined
    }
    current = current[segment]
  }
  return current
}

// buildStorePackage 把基础成品包加工成商店包：解包后写入商店清单与图标，再重打包到协议目录的产出区。
// 商店清单由协议目录内手写的 fw-app.json 转换而来：补具体版本、图标改包内基准，其余字段原样内联。
function buildStorePackage(protocolDir, artifact) {
  const dir = path.resolve(protocolDir)
  const sourcePathValue = typeof artifact.path === 'string' ? artifact.path.trim() : ''
  if (sourcePathValue === '') {
    throw new Error('商店化需要成品路径：命令输出没有提供 artifact.path')
  }
  const sourcePath = path.resolve(sourcePathValue)
  const root = path.dirname(dir)
  const manifest = readSourceManifest(path.join(dir, sourceManifestFileName))
  const version = readStoreVersion(root, manifest.versionSource)
  const executable = resolveManifestPath(manifest.package?.windowsExecutable, 'package.windowsExecutable')
  const iconRelative = resolveManifestPath(manifest.package?.icon, 'package.icon')
  const iconSource = path.join(root, iconRelative)
  let iconInfo
  try {
    iconInfo = statSync(iconSource)
  } catch {
    throw new Error(`图标文件不存在：${iconRelative}`)
  }
  if (!iconInfo.isFile()) {
    throw new Error(`图标文件不存在：${iconRelative}`)
  }

  const tempDir = mkdtempSync(path.join(tmpdir(), 'fast-window-dev-store-'))
  try {
    unpackZip(sourcePath, tempDir)
    const iconTarget = path.posix.join(storeIconDirName, path.posix.basename(iconRelative))
    copyFileInto(path.join(tempDir, iconTarget), iconSource)
    writeStoreManifest(tempDir, manifest, { version, executable, icon: iconTarget })
    const distDir = path.join(dir, storePackageDirName)
    mkdirSync(distDir, { recursive: true })
    const targetPath = path.join(distDir, path.basename(sourcePath))
    packZipDirectory(tempDir, targetPath)
    return {
      path: targetPath,
      name: path.basename(targetPath),
      sha256: sha256OfFile(targetPath),
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

function readSourceManifest(file) {
  let payload
  try {
    payload = readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error(`读取应用清单失败：${error.message}`)
  }
  let manifest
  try {
    manifest = JSON.parse(payload)
  } catch (error) {
    throw new Error(`解析应用清单失败：${error.message}`)
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('解析应用清单失败：顶层必须是 JSON 对象')
  }
  for (const field of ['type', 'id', 'name', 'description', 'versionSource', 'displayMode']) {
    if (manifest[field] !== undefined && typeof manifest[field] !== 'string') {
      throw new Error(`应用清单 ${field} 必须是字符串`)
    }
  }
  if (manifest.package !== undefined && manifest.package !== null) {
    if (typeof manifest.package !== 'object' || Array.isArray(manifest.package)) {
      throw new Error('应用清单 package 必须是 JSON 对象')
    }
    for (const field of ['windowsExecutable', 'icon']) {
      if (manifest.package[field] !== undefined && typeof manifest.package[field] !== 'string') {
        throw new Error(`应用清单 package.${field} 必须是字符串`)
      }
    }
  }
  if (!isNonEmptyString(manifest.id)) {
    throw new Error('应用清单缺少 id')
  }
  if (!isNonEmptyString(manifest.name)) {
    throw new Error('应用清单缺少 name')
  }
  if (!isNonEmptyString(manifest.versionSource)) {
    throw new Error('应用清单缺少 versionSource')
  }
  validateSourceService(manifest.type, manifest.service)
  normalizeCommands(manifest.commands)
  return manifest
}

function validateSourceService(appType, service) {
  const type = typeof appType === 'string' ? appType.trim() : ''
  if (type === appTypeDesktopApp) {
    if (service !== undefined && service !== null) {
      throw new Error(`清单 type 为 ${appTypeDesktopApp} 时不允许携带 service 段`)
    }
    return
  }
  if (type === appTypeServiceApp) {
    if (service === undefined || service === null) {
      throw new Error(`清单 type 为 ${appTypeServiceApp} 时必须提供 service 段`)
    }
    if (typeof service !== 'object' || Array.isArray(service)) {
      throw new Error('service 段必须是 JSON 对象')
    }
    return
  }
  throw new Error(`清单 type 必须为 ${appTypeDesktopApp} 或 ${appTypeServiceApp}`)
}

function normalizeCommands(value) {
  if (value === undefined || value === null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new Error('应用清单 commands 必须是数组')
  }
  return value.map((command, index) => {
    if (
      command === null ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      typeof command.id !== 'string' ||
      typeof command.title !== 'string'
    ) {
      throw new Error(`应用清单 commands[${index}] 不合法`)
    }
    return { id: command.id, title: command.title }
  })
}

function readStoreVersion(root, versionSource) {
  const relative = resolveManifestPath(versionSource, 'versionSource')
  let payload
  try {
    payload = readFileSync(path.join(root, relative), 'utf8')
  } catch (error) {
    throw new Error(`读取 versionSource 失败：${error.message}`)
  }
  let info
  try {
    info = JSON.parse(payload)
  } catch (error) {
    throw new Error(`解析 versionSource 失败：${error.message}`)
  }
  const version = typeof info?.version === 'string' ? info.version.trim() : ''
  if (version === '') {
    throw new Error('versionSource 缺少 version')
  }
  return version
}

function resolveManifestPath(value, field) {
  const normalized = String(value ?? '').trim().replaceAll('\\', '/')
  if (normalized === '') {
    throw new Error(`${field} 不能为空`)
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || path.posix.isAbsolute(normalized)) {
    throw new Error(`${field} 不允许是绝对路径：${normalized}`)
  }
  for (const segment of normalized.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`${field} 不安全：${normalized}`)
    }
  }
  return normalized
}

function writeStoreManifest(packageRoot, manifest, facts) {
  const storeManifest = {
    type: manifest.type,
    id: manifest.id,
    name: manifest.name,
  }
  if (typeof manifest.description === 'string' && manifest.description !== '') {
    storeManifest.description = manifest.description
  }
  storeManifest.version = facts.version
  storeManifest.package = {
    windowsExecutable: facts.executable,
    icon: facts.icon,
  }
  if (manifest.service !== undefined && manifest.service !== null) {
    storeManifest.service = manifest.service
  }
  if (typeof manifest.displayMode === 'string' && manifest.displayMode !== '') {
    storeManifest.displayMode = manifest.displayMode
  }
  const commands = normalizeCommands(manifest.commands)
  if (commands.length > 0) {
    storeManifest.commands = commands
  }
  try {
    writeFileSync(path.join(packageRoot, storeManifestFileName), `${JSON.stringify(storeManifest, null, 2)}\n`, 'utf8')
  } catch (error) {
    throw new Error(`写入 fw-app.json 失败：${error.message}`)
  }
}

function copyFileInto(target, source) {
  mkdirSync(path.dirname(target), { recursive: true })
  let payload
  try {
    payload = readFileSync(source)
  } catch (error) {
    throw new Error(`读取图标文件失败：${error.message}`)
  }
  try {
    writeFileSync(target, payload)
  } catch (error) {
    throw new Error(`写入图标文件失败：${error.message}`)
  }
}

function sha256OfFile(file) {
  let payload
  try {
    payload = readFileSync(file)
  } catch (error) {
    throw new Error(`读取商店包失败：${error.message}`)
  }
  return createHash('sha256').update(payload).digest('hex')
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

// ------------- ZIP 读写（零外部依赖，只支持普通 ZIP：不处理分卷与 Zip64） -------------

function findZipEndRecord(archive) {
  const earliest = Math.max(0, archive.length - 22 - 0xffff)
  for (let offset = archive.length - 22; offset >= earliest; offset -= 1) {
    if (archive.readUInt32LE(offset) === zipEndOfCentralDirectorySignature) {
      return offset
    }
  }
  throw new Error('成品包结构损坏：找不到中央目录结尾记录')
}

function unpackZip(archivePath, targetDir) {
  let archive
  try {
    archive = readFileSync(archivePath)
  } catch (error) {
    throw new Error(`打开成品包失败：${error.message}`)
  }
  const endOffset = findZipEndRecord(archive)
  if (archive.readUInt16LE(endOffset + 4) !== 0 || archive.readUInt16LE(endOffset + 6) !== 0) {
    throw new Error('成品包结构损坏：不支持分卷 ZIP')
  }
  const totalEntries = archive.readUInt16LE(endOffset + 10)
  const centralSize = archive.readUInt32LE(endOffset + 12)
  const centralOffset = archive.readUInt32LE(endOffset + 16)
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('暂不支持 Zip64 格式的成品包')
  }
  if (centralOffset + centralSize > archive.length) {
    throw new Error('成品包结构损坏：中央目录越界')
  }
  const cleanTarget = path.resolve(targetDir)
  let cursor = centralOffset
  for (let index = 0; index < totalEntries; index += 1) {
    if (archive.readUInt32LE(cursor) !== zipCentralDirectorySignature) {
      throw new Error('成品包结构损坏：中央目录记录签名异常')
    }
    const flags = archive.readUInt16LE(cursor + 8)
    const method = archive.readUInt16LE(cursor + 10)
    const expectedCrc = archive.readUInt32LE(cursor + 16)
    const compressedSize = archive.readUInt32LE(cursor + 20)
    const uncompressedSize = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const localOffset = archive.readUInt32LE(cursor + 42)
    const entryName = archive
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString((flags & zipUTF8Flag) !== 0 ? 'utf8' : 'latin1')
    cursor += 46 + nameLength + extraLength + commentLength
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('暂不支持 Zip64 格式的成品包')
    }
    const cleanName = path.posix.normalize(entryName.replaceAll('\\', '/'))
    if (cleanName === '' || cleanName === '.') {
      continue
    }
    if (cleanName.startsWith('/') || /^[A-Za-z]:/.test(cleanName) || cleanName === '..' || cleanName.startsWith('../')) {
      throw new Error(`成品包含不安全路径：${entryName}`)
    }
    const destination = path.join(cleanTarget, cleanName)
    if (entryName.endsWith('/')) {
      mkdirSync(destination, { recursive: true })
      continue
    }
    if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== zipLocalHeaderSignature) {
      throw new Error('成品包结构损坏：条目头签名异常')
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26)
    const localExtraLength = archive.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    if (dataStart + compressedSize > archive.length) {
      throw new Error(`成品包结构损坏：条目数据越界（${entryName}）`)
    }
    const compressed = archive.subarray(dataStart, dataStart + compressedSize)
    let payload
    if (method === zipMethodStore) {
      payload = compressed
    } else if (method === zipMethodDeflate) {
      try {
        payload = inflateRawSync(compressed)
      } catch (error) {
        throw new Error(`读取成品包条目失败：${entryName}（${error.message}）`)
      }
    } else {
      throw new Error(`成品包条目压缩方式不受支持：${entryName}（method ${method}）`)
    }
    if (crc32(payload) !== expectedCrc) {
      throw new Error(`成品包条目校验失败：${entryName}`)
    }
    mkdirSync(path.dirname(destination), { recursive: true })
    writeFileSync(destination, payload)
  }
}

function collectFiles(sourceDir) {
  const files = []
  const walk = (currentDir, prefix) => {
    const entries = readdirSync(currentDir, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )
    for (const entry of entries) {
      const absolute = path.join(currentDir, entry.name)
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        walk(absolute, relative)
      } else if (entry.isFile()) {
        files.push({ absolute, relative, modified: statSync(absolute).mtime })
      }
    }
  }
  walk(sourceDir, '')
  return files
}

function toDosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980)
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f)
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: day }
}

function packZipDirectory(sourceDir, targetPath) {
  const files = collectFiles(sourceDir)
  if (files.length > 0xffff) {
    throw new Error('商店包文件数量超出普通 ZIP 上限')
  }
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.relative, 'utf8')
    const data = readFileSync(file.absolute)
    const compressed = deflateRawSync(data)
    const checksum = crc32(data)
    const stamps = toDosDateTime(file.modified)
    const flags = /[^\x00-\x7f]/.test(file.relative) ? zipUTF8Flag : 0

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(zipLocalHeaderSignature, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(flags, 6)
    localHeader.writeUInt16LE(zipMethodDeflate, 8)
    localHeader.writeUInt16LE(stamps.time, 10)
    localHeader.writeUInt16LE(stamps.date, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, name, compressed)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(zipCentralDirectorySignature, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(flags, 8)
    centralHeader.writeUInt16LE(zipMethodDeflate, 10)
    centralHeader.writeUInt16LE(stamps.time, 12)
    centralHeader.writeUInt16LE(stamps.date, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)

    offset += localHeader.length + name.length + compressed.length
  }
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(zipEndOfCentralDirectorySignature, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  try {
    writeFileSync(targetPath, Buffer.concat([...localParts, centralDirectory, end]))
  } catch (error) {
    throw new Error(`创建商店包失败：${error.message}`)
  }
}

function writeReceipt(output, value) {
  output.write(`${receiptPrefix}${JSON.stringify(value)}\n`)
}

async function main() {
  const receipt = await executeAction(process.argv.slice(2))
  try {
    writeReceipt(process.stdout, receipt)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
    return
  }
  process.exitCode = receipt.status === statusSucceeded ? 0 : 1
}

const isDirectRun = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  await main()
}

export { buildStorePackage, packZipDirectory, unpackZip }
