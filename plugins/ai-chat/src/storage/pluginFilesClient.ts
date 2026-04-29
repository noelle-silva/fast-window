import { FILES_SCOPE } from './storageCodec'

function dataUrlToBytes(dataUrl: any) {
  const s = String(dataUrl ?? '').trim()
  if (!s.startsWith('data:')) throw new Error('base64 data URL 格式不合法')
  const i = s.indexOf(',')
  if (i < 0) throw new Error('base64 data URL 格式不合法')
  const b64 = s.slice(i + 1).trim()
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j)
  return bytes
}

export function createPluginFilesClient(tauri: any, pluginId: string) {
  const pid = String(pluginId || '').trim()
  if (!pid) throw new Error('pluginId 为空')

  async function listDir(dir?: any) {
    return tauri.invoke({
      command: 'plugin_files_list_dir',
      payload: { pluginId: pid, req: { scope: FILES_SCOPE, dir: dir == null ? null : String(dir) } },
    })
  }

  async function readText(path: any) {
    return tauri.invoke({
      command: 'plugin_files_read_text',
      payload: { pluginId: pid, req: { scope: FILES_SCOPE, path: String(path || '') } },
    })
  }

  async function readBase64(path: any) {
    return tauri.invoke({
      command: 'plugin_files_read_base64',
      payload: { pluginId: pid, req: { scope: FILES_SCOPE, path: String(path || '') } },
    })
  }

  async function writeText(path: any, text: any) {
    return tauri.invoke({
      command: 'plugin_files_write_text',
      payload: {
        pluginId: pid,
        req: { scope: FILES_SCOPE, path: String(path || ''), text: String(text ?? ''), overwrite: true },
      },
    })
  }

  async function del(path: any) {
    return tauri.invoke({
      command: 'plugin_files_delete',
      payload: { pluginId: pid, req: { scope: FILES_SCOPE, path: String(path || '') } },
    })
  }

  async function readJson(path: any) {
    let text = ''
    try {
      text = await readText(path)
    } catch (e) {
      const msg = String((e as any)?.message || e || '')
      if (msg.includes('文件不存在')) return null
      throw e
    }
    const s = String(text || '').trim()
    if (!s) return null
    try {
      return JSON.parse(s)
    } catch {
      throw new Error(`JSON 解析失败：${String(path || '')}`)
    }
  }

  async function readJsonMaybeLarge(path: any) {
    try {
      return await readJson(path)
    } catch (e) {
      const msg = String((e as any)?.message || e || '')
      if (!msg.includes('文本文件过大') && !msg.includes('文本不是 UTF-8')) throw e
    }
    const dataUrl = await readBase64(path)
    const bytes = dataUrlToBytes(dataUrl)
    const text = new TextDecoder('utf-8').decode(bytes)
    try {
      return JSON.parse(String(text || '').trim() || 'null')
    } catch {
      throw new Error(`JSON 解析失败：${String(path || '')}`)
    }
  }

  async function writeJson(path: any, value: any) {
    const text = JSON.stringify(value ?? null, null, 2) + '\n'
    await writeText(path, text)
  }

  async function deleteIfExists(path: any) {
    try {
      await del(path)
    } catch (e) {
      const msg = String((e as any)?.message || e || '')
      if (msg.includes('文件不存在')) return
      throw e
    }
  }

  return {
    pluginId: pid,
    listDir,
    readJson,
    readJsonMaybeLarge,
    writeJson,
    deleteIfExists,
  }
}
