export const VERSION = 7
export const SPLIT_SCHEMA_VERSION = 1
export const SPLIT_META_KEY = 'meta/index'
export const STICKERS_KEY = 'stickers/index'

export const MAX_DRAFT_IMAGES = 8
export const MAX_DRAFT_FILES = 6
export const MAX_DRAFT_FILE_BYTES = 10 * 1024 * 1024
export const DEFAULT_ATTACH_MAX_FILE_MB = Math.round(MAX_DRAFT_FILE_BYTES / 1024 / 1024)
export const MAX_ATTACH_MAX_FILE_MB = 2048
export const DEFAULT_ATTACH_SEND_LIMIT_CHARS = 80_000
export const DEFAULT_TOOL_CALL_SERVER_BASE_URL = 'http://localhost:9083'
export const REF_IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA='
export const NEW_ROLE_ID = '__new__'
export const NEW_GROUP_ID = '__new_group__'
export const GROUP_SPEAKER_USER_PREFIX = '用户'

export const DEFAULT_MERMAID_FIX_SYSTEM_PROMPT = `你是 Mermaid 语法修复器。

你会收到一段 Mermaid 源码（可能无法渲染）。你的任务：在尽量保持原意不变的前提下，修复语法/结构错误，让它可以被 Mermaid 渲染。

输出要求：
- 只输出修复后的 Mermaid 源码本体
- 不要输出解释、不要输出 Markdown 代码块标记（不要输出 \`\`\`mermaid）`

export const DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT = `你是“聊天标题生成器”。

你会收到一段聊天记录。你的任务：为这段聊天生成一个简短、贴切的中文标题。

输出要求：
- 只输出标题本身（纯文本）
- 不要输出引号、不要输出解释
- 尽量不超过 20 个汉字`

export const DEFAULT_STICKER_NAMING_SYSTEM_PROMPT = `你是“表情包取名助手”。

你会收到一张表情包图片。你的任务：根据图片内容给它取一个简短、好记的中文名字。

输出要求：
- 只输出名字本身（纯文本）
- 不要输出引号、不要输出解释
- 不要包含 / 或 \\ 或 ] 或换行
- 尽量不超过 12 个汉字`

export const CHAT_ATTACHMENT_KINDS = new Set(['txt', 'md', 'pdf', 'docx', 'ppt'])
export const CHAT_MSG_GROUP_ROLES = new Set(['root', 'attachment'])
export const CHAT_BRANCHING_SCHEMA_VERSION = 1
export const CHAT_DEFAULT_BRANCH_ID = 'main'
export const CHAT_DEFAULT_BRANCH_NAME = '主线'
