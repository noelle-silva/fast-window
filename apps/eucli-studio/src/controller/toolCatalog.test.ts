import { afterEach, describe, expect, it, vi } from 'vitest'
import { createToolCatalog } from './toolCatalog'

function artifactState(id: string, status: string, message = ''): any {
  return {
    operationId: 'op-' + id,
    artifact: { kind: 'tool', id },
    installed: false,
    currentVersion: '',
    targetVersion: '0.1.0',
    status,
    phase: 'prepare',
    progress: { receivedBytes: 0, totalBytes: 0 },
    error: { code: status === 'blocked' ? 'INCOMPATIBLE' : '', phase: '', message },
  }
}

function createHarness(options?: { importResult?: any }) {
  const state: any = { tools: {} }
  const toasts: Array<{ message: string; kind?: string }> = []
  const requests: any[] = []
  const netRequest = vi.fn(async (req: any) => {
    requests.push(req)
    return { status: 200, body: [] }
  })
  const pickArchiveFile = vi.fn(async () => 'E:\\packs\\local-demo.zip')
  const pickArchiveFolder = vi.fn(async () => 'E:\\packs\\local-demo')
  const importArtifactPackage = vi.fn(async () => options?.importResult ?? artifactState('local-demo', 'active'))
  const catalog = createToolCatalog({
    getState: () => state,
    netRequest,
    pickArchiveFile,
    pickArchiveFolder,
    importArtifactPackage,
    emit: () => {},
    showToast: (message: any, opts?: any) => toasts.push({ message: String(message), kind: opts?.kind }),
  })
  return { catalog, state, toasts, requests, netRequest, pickArchiveFile, pickArchiveFolder, importArtifactPackage }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('tool package import', () => {
  it('does nothing when the user cancels file selection', async () => {
    const harness = createHarness()
    harness.pickArchiveFile.mockResolvedValue(null)
    await harness.catalog.importToolPackage()
    expect(harness.importArtifactPackage).not.toHaveBeenCalled()
    expect(harness.toasts).toEqual([])
  })

  it('imports the archive via the direct channel and refreshes the tool list', async () => {
    const harness = createHarness()
    await harness.catalog.importToolPackage()
    expect(harness.importArtifactPackage).toHaveBeenCalledWith({ kind: 'tool', filePath: 'E:\\packs\\local-demo.zip' })
    expect(harness.state.tools.installStates['local-demo'].status).toBe('active')
    expect(harness.requests.some((req) => req.path === '/api/tools')).toBe(true)
    expect(harness.toasts).toEqual([{ message: '安装包已导入', kind: 'success' }])
  })

  it('imports a product folder through the folder picker', async () => {
    const harness = createHarness()
    await harness.catalog.importToolFolder()
    expect(harness.importArtifactPackage).toHaveBeenCalledWith({ kind: 'tool', filePath: 'E:\\packs\\local-demo' })
    expect(harness.state.tools.installStates['local-demo'].status).toBe('active')
  })

  it('reports the rejection reason when the import is blocked', async () => {
    const harness = createHarness({ importResult: artifactState('local-demo', 'blocked', '当前 eucli-box 版本 0.1.0 不在所需范围 [0.9.0, 1.0.0) 内') })
    await harness.catalog.importToolPackage()
    expect(harness.toasts).toHaveLength(1)
    expect(harness.toasts[0].kind).toBe('error')
    expect(harness.toasts[0].message).toContain('不在所需范围')
    expect(harness.requests.some((req) => req.path === '/api/tools')).toBe(false)
  })

  it('reports the failure when the import request fails', async () => {
    const harness = createHarness()
    harness.importArtifactPackage.mockRejectedValue(new Error('导入包核验失败：工具包缺少工具定义文件'))
    await harness.catalog.importToolPackage()
    expect(harness.toasts).toHaveLength(1)
    expect(harness.toasts[0].kind).toBe('error')
    expect(harness.toasts[0].message).toContain('工具定义文件')
  })
})
