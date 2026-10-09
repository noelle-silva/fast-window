import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..')
const templateDir = path.join(__dirname, 'face-plugin-template')

// 类型标识同时作为目录名、Go 包名与面类型值：必须是小写字母开头、仅含小写字母与数字。
const KIND_PATTERN = /^[a-z][a-z0-9]*$/
const FACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const TOOLBAR_SLOTS = ['left', 'right', 'both']

// 能力画像默认值：可编辑、可预览、可新建、可删除，默认不可搜索（搜索需自行提供搜索文本）。
const DEFAULT_CAPABILITIES = {
  editable: true,
  searchable: false,
  previewable: true,
  creatable: true,
  deletable: true,
}

// 可选骨架件默认全关，指定才生成：引用提取、工具条插槽、只读内容预览、设置项声明。
const DEFAULT_OPTIONAL = {
  refs: false,
  toolbar: '',
  contentPreview: false,
  settings: false,
}

/** 解析命令行参数为原始入参（含能力开关、可选骨架件与 dry-run）。 */
export function parseFaceArgs(argv) {
  const params = {
    kind: '',
    label: '',
    faceId: '',
    fileName: '',
    ...DEFAULT_CAPABILITIES,
    ...DEFAULT_OPTIONAL,
    dryRun: false,
    help: false,
  }
  const args = argv.slice(2).filter(arg => arg !== '--')
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') params.help = true
    else if (arg === '--dry-run') params.dryRun = true
    else if (arg === '--kind') params.kind = readValue(args, ++index, arg)
    else if (arg === '--label') params.label = readValue(args, ++index, arg)
    else if (arg === '--face-id') params.faceId = readValue(args, ++index, arg)
    else if (arg === '--file-name') params.fileName = readValue(args, ++index, arg)
    else if (arg === '--toolbar') params.toolbar = readValue(args, ++index, arg)
    else if (arg === '--editable') params.editable = true
    else if (arg === '--no-editable') params.editable = false
    else if (arg === '--searchable') params.searchable = true
    else if (arg === '--no-searchable') params.searchable = false
    else if (arg === '--previewable') params.previewable = true
    else if (arg === '--no-previewable') params.previewable = false
    else if (arg === '--creatable') params.creatable = true
    else if (arg === '--no-creatable') params.creatable = false
    else if (arg === '--deletable') params.deletable = true
    else if (arg === '--no-deletable') params.deletable = false
    else if (arg === '--refs') params.refs = true
    else if (arg === '--no-refs') params.refs = false
    else if (arg === '--content-preview') params.contentPreview = true
    else if (arg === '--no-content-preview') params.contentPreview = false
    else if (arg === '--settings') params.settings = true
    else if (arg === '--no-settings') params.settings = false
    else throw new Error(`未知参数：${arg}`)
  }
  return params
}

/** 校验入参并补齐默认值（默认面标识回退类型标识、默认文件名回退 <类型标识>.txt）。 */
export function normalizeFaceParams(input) {
  const kind = String(input.kind || '').trim()
  if (!KIND_PATTERN.test(kind)) {
    throw new Error(`类型标识非法（要求小写字母开头、仅含小写字母与数字）：${JSON.stringify(input.kind)}`)
  }
  const label = String(input.label || '').trim()
  if (!label) throw new Error('缺少展示名')
  assertSafeLiteral(label, '展示名')
  const faceId = String(input.faceId || '').trim() || kind
  if (!FACE_ID_PATTERN.test(faceId)) throw new Error(`默认面标识非法：${JSON.stringify(faceId)}`)
  const fileName = String(input.fileName || '').trim() || `${kind}.txt`
  assertSafeFileName(fileName)
  const toolbar = String(input.toolbar || '').trim()
  if (toolbar && !TOOLBAR_SLOTS.includes(toolbar)) {
    throw new Error(`工具条插槽非法（应为 left/right/both）：${JSON.stringify(input.toolbar)}`)
  }
  return {
    kind,
    label,
    faceId,
    fileName,
    editable: input.editable !== false,
    searchable: input.searchable === true,
    previewable: input.previewable !== false,
    creatable: input.creatable !== false,
    deletable: input.deletable !== false,
    refs: input.refs === true,
    toolbar,
    contentPreview: input.contentPreview === true,
    settings: input.settings === true,
    dryRun: input.dryRun === true,
    help: input.help === true,
  }
}

/** 由入参生成待落盘的文件清单（路径 + 内容）；能力与可选件决定文件集合与可选代码块。 */
export async function buildFaceFiles(input) {
  const params = normalizeFaceParams(input)
  const pascal = params.kind.charAt(0).toUpperCase() + params.kind.slice(1)
  const extractRefsFn = `extract${pascal}FaceRefs`

  const localImports = []
  if (params.contentPreview) localImports.push(`import { ${pascal}ContentPreview } from './contentPreview'\n`)
  if (params.editable) localImports.push(`import { ${pascal}EditView } from './editView'\n`)
  if (params.refs) localImports.push(`import { ${extractRefsFn} } from './extractRefs'\n`)
  localImports.push(`import { ${pascal}ReadView } from './readView'\n`)
  if (params.toolbar) localImports.push(`import { ${toolbarComponentNames(params.toolbar, pascal).join(', ')} } from './toolbar'\n`)

  const optionalFields = []
  if (params.toolbar) {
    const slots = []
    if (params.toolbar === 'left' || params.toolbar === 'both') slots.push(`left: ${pascal}LeftToolbar`)
    if (params.toolbar === 'right' || params.toolbar === 'both') slots.push(`right: ${pascal}RightToolbar`)
    optionalFields.push(`  Toolbars: { ${slots.join(', ')} },\n`)
  }
  if (params.contentPreview) optionalFields.push(`  ContentPreview: ${pascal}ContentPreview,\n`)
  if (params.refs) optionalFields.push(`  extractRefs: ${extractRefsFn},\n`)

  const values = {
    KIND: params.kind,
    LABEL: params.label,
    FACE_ID: params.faceId,
    FILE_NAME: params.fileName,
    PACKAGE: params.kind,
    PASCAL: pascal,
    CAP_EDITABLE: String(params.editable),
    CAP_SEARCHABLE: String(params.searchable),
    CAP_PREVIEWABLE: String(params.previewable),
    CAP_CREATABLE: String(params.creatable),
    CAP_DELETABLE: String(params.deletable),
    LOCAL_IMPORTS: localImports.join(''),
    EDIT_VIEW_FIELD: params.editable ? `  EditView: ${pascal}EditView,\n` : '',
    OPTIONAL_FIELDS: optionalFields.join(''),
    EXTRACT_REFS_LINE: params.refs ? '\t\tExtractRefs:       ExtractRefs,\n' : '',
    SEARCH_TEXT_LINE: params.searchable ? '\t\tSearchText:        SearchText,\n' : '',
    SETTINGS_LINES: params.settings
      ? `\t\tSettingsTitle:     "${params.label}面设置",\n\t\tSettingsIntro:     "${params.label}面的可配置项。",\n\t\tSettings:          settingsDeclaration(),\n`
      : '',
    TOOLBAR_BLOCKS: buildToolbarBlocks(params, pascal),
  }

  const frontendDir = path.posix.join('src/facePlugins', params.kind)
  const backendDir = path.posix.join('backend-go/faceplugins', params.kind)
  const specs = [
    { target: `${frontendDir}/index.ts`, template: 'frontend/index.ts.tmpl' },
    { target: `${frontendDir}/readView.tsx`, template: 'frontend/readView.tsx.tmpl' },
    ...(params.editable ? [{ target: `${frontendDir}/editView.tsx`, template: 'frontend/editView.tsx.tmpl' }] : []),
    ...(params.refs ? [{ target: `${frontendDir}/extractRefs.ts`, template: 'frontend/extractRefs.ts.tmpl' }] : []),
    ...(params.toolbar ? [{ target: `${frontendDir}/toolbar.tsx`, template: 'frontend/toolbar.tsx.tmpl' }] : []),
    ...(params.contentPreview ? [{ target: `${frontendDir}/contentPreview.tsx`, template: 'frontend/contentPreview.tsx.tmpl' }] : []),
    { target: `${backendDir}/plugin.go`, template: 'backend/plugin.go.tmpl' },
    ...(params.refs ? [{ target: `${backendDir}/refs.go`, template: 'backend/refs.go.tmpl' }] : []),
    ...(params.searchable ? [{ target: `${backendDir}/search_text.go`, template: 'backend/search_text.go.tmpl' }] : []),
    ...(params.settings ? [{ target: `${backendDir}/settings.go`, template: 'backend/settings.go.tmpl' }] : []),
  ]
  const files = []
  for (const spec of specs) {
    const raw = await fs.readFile(path.join(templateDir, spec.template), 'utf8')
    files.push({ path: spec.target, content: renderFaceTemplate(raw, values) })
  }
  return { params, frontendDir, backendDir, files }
}

/** 替换模板占位符；出现未知占位符直接失败，避免留下半成品。 */
export function renderFaceTemplate(content, values) {
  return content.replace(/\{\{([A-Z_]+)\}\}/g, (match, token) => {
    if (!(token in values)) throw new Error(`模板占位符未知：${token}`)
    return values[token]
  })
}

function toolbarComponentNames(toolbar, pascal) {
  const names = []
  if (toolbar === 'left' || toolbar === 'both') names.push(`${pascal}LeftToolbar`)
  if (toolbar === 'right' || toolbar === 'both') names.push(`${pascal}RightToolbar`)
  return names
}

function buildToolbarBlocks(params, pascal) {
  const blocks = []
  if (params.toolbar === 'left' || params.toolbar === 'both') blocks.push(toolbarBlock(`${pascal}LeftToolbar`, params.label, '左'))
  if (params.toolbar === 'right' || params.toolbar === 'both') blocks.push(toolbarBlock(`${pascal}RightToolbar`, params.label, '右'))
  return blocks.join('\n\n')
}

function toolbarBlock(name, label, slotText) {
  return [
    `/** ${label}面工具条${slotText}插槽：骨架实现，按真实控件替换。 */`,
    `export function ${name}({ disabled }: FaceToolbarProps): React.ReactNode {`,
    '  return (',
    `    <Tooltip title="${label}面操作" placement="bottom-start">`,
    `      <IconButton size="small" aria-label="${label}面操作" disabled={disabled} onClick={() => {}}>`,
    '        <TuneRoundedIcon fontSize="small" />',
    '      </IconButton>',
    '    </Tooltip>',
    '  )',
    '}',
  ].join('\n')
}

async function main() {
  const args = parseFaceArgs(process.argv)
  if (args.help || !args.kind || !args.label) {
    printUsage()
    if (!args.help) process.exitCode = 1
    return
  }
  const { params, frontendDir, backendDir, files } = await buildFaceFiles(args)
  if (params.dryRun) {
    process.stdout.write(`[dry-run] 将生成 ${files.length} 个文件：\n\n`)
    for (const file of files) {
      process.stdout.write(`===== ${file.path} =====\n${file.content}\n`)
    }
    return
  }
  await ensureTargetsFree([frontendDir, backendDir])
  for (const file of files) {
    const absolute = path.join(appDir, ...file.path.split('/'))
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, file.content, 'utf8')
  }
  process.stdout.write(`已生成${params.label}面骨架（${files.length} 个文件）：\n`)
  for (const file of files) process.stdout.write(`  ${file.path}\n`)
  process.stdout.write(`\n${registrationHint(params)}\n`)
}

/** 目标目录已存在则拒绝，避免覆盖已有面。 */
async function ensureTargetsFree(dirs) {
  for (const dir of dirs) {
    const absolute = path.join(appDir, ...dir.split('/'))
    try {
      await fs.access(absolute)
      throw new Error(`目标目录已存在，拒绝覆盖：${dir}`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

/** 打印手动登记指引（脚本不自动改写装配清单）。 */
function registrationHint(params) {
  const alias = `${params.kind}plugin`
  return [
    '下一步（脚本不会自动登记，请手动各加一行）：',
    '  1. src/facePlugins/index.ts：',
    `     import { ${params.kind}FaceViewPlugin } from './${params.kind}'`,
    `     registerFaceViewPlugin(${params.kind}FaceViewPlugin)`,
    '  2. backend-go/face_plugin_assembly.go：',
    `     ${alias} "fast-window-hypercortex-backend/faceplugins/${params.kind}"`,
    `     mustRegisterFacePlugin(${alias}.Plugin())`,
  ].join('\n')
}

function printUsage() {
  const lines = [
    '用法：node scripts/new-face.mjs --kind <类型标识> --label <展示名> [选项]',
    '',
    '基础选项：',
    '  --face-id <默认面标识>            缺省等于类型标识',
    '  --file-name <默认文件名>          缺省为 <类型标识>.txt',
    '  --editable / --no-editable        是否可编辑，缺省可编辑',
    '  --searchable / --no-searchable    是否可搜索，缺省不可搜索',
    '  --previewable / --no-previewable  是否可预览，缺省可预览',
    '  --creatable / --no-creatable      是否可新建，缺省可新建',
    '  --deletable / --no-deletable      是否可删除，缺省可删除',
    '',
    '可选骨架件（默认全关，指定才生成）：',
    '  --refs                            引用提取：后端 refs.go + 前端 extractRefs.ts',
    '  --toolbar left|right|both         工具条插槽：前端 toolbar.tsx + Toolbars',
    '  --content-preview                 只读内容预览：前端 contentPreview.tsx + ContentPreview',
    '  --settings                        设置项声明：后端 settings.go + Settings',
    '',
    '其他：',
    '  --dry-run                         只打印将生成的文件，不落盘',
    '  --help                            显示本帮助',
    '',
    '类型标识要求：小写字母开头，仅含小写字母与数字（同时作为 Go 包名与目录名）。',
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
}

function readValue(args, index, flag) {
  const value = args[index]
  if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${flag} 缺少取值`)
  return value
}

function assertSafeLiteral(value, name) {
  if (/["\\\r\n\t]/.test(value)) throw new Error(`${name}不能包含引号、反斜杠或换行`)
}

function assertSafeFileName(value) {
  if (/[\\/\r\n\t"]/.test(value)) throw new Error(`默认文件名非法：${JSON.stringify(value)}`)
}

const isEntry = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false
if (isEntry) {
  main().catch(error => {
    process.stderr.write(`[new-face] ${String(error?.message || error)}\n`)
    process.exit(1)
  })
}
