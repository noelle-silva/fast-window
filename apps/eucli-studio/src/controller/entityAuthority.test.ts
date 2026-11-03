import { describe, expect, it, vi } from 'vitest'
import { createEntityAuthorityReader } from './entityAuthority'

function createReader(netRequest: (req: any) => Promise<any>) {
  return createEntityAuthorityReader({
    netRequest,
    resourcePath: '/api/roles',
    entityLabel: '角色',
  })
}

describe('通用实体权威读取', () => {
  it('按实体地址 GET 并返回 body', async () => {
    const netRequest = vi.fn(async () => ({ status: 200, body: { id: 'role-a', name: '角色A' } }))
    const readRole = createReader(netRequest)

    await expect(readRole('role-a')).resolves.toEqual({ id: 'role-a', name: '角色A' })
    expect(netRequest).toHaveBeenCalledWith({ method: 'GET', path: '/api/roles/role-a' })
  })

  it('实体编号进入路径段前做 URL 编码', async () => {
    const netRequest = vi.fn(async () => ({ status: 200, body: { id: 'role/1' } }))
    const readRole = createReader(netRequest)

    await readRole('role/1')

    expect(netRequest).toHaveBeenCalledWith({ method: 'GET', path: '/api/roles/role%2F1' })
  })

  it('HTTP 404 映射为 null（实体确定不存在）', async () => {
    const readRole = createReader(async () => ({ status: 404, body: null }))

    await expect(readRole('role-a')).resolves.toBeNull()
  })

  it('异常 details.statusCode=404 同样映射为 null', async () => {
    const error = Object.assign(new Error('not found'), { details: { statusCode: 404 } })
    const readRole = createReader(async () => { throw error })

    await expect(readRole('role-a')).resolves.toBeNull()
  })

  it.each(['role.not_found', 'ROLE.NOT_FOUND', 'NOT_FOUND'])(
    '业务错误码 %s 映射为 null',
    async (code) => {
      const error = Object.assign(new Error('not found'), { details: { json: { error: { code } } } })
      const readRole = createReader(async () => { throw error })

      await expect(readRole('role-a')).resolves.toBeNull()
    },
  )

  it('工作区资源同样识别 workspace.not_found', async () => {
    const error = Object.assign(new Error('workspace not found'), { details: { json: { error: { code: 'workspace.not_found' } } } })
    const readWorkspace = createEntityAuthorityReader({
      netRequest: async () => { throw error },
      resourcePath: '/api/workspaces',
      entityLabel: '工作区',
    })

    await expect(readWorkspace('ws-1')).resolves.toBeNull()
  })

  it('其他错误原样抛出，交给上层标记结果未确认', async () => {
    const error = new Error('连接断开')
    const readRole = createReader(async () => { throw error })

    await expect(readRole('role-a')).rejects.toBe(error)
  })

  it('非 2xx 响应状态视为读取失败', async () => {
    const readRole = createReader(async () => ({ status: 500, body: null }))

    await expect(readRole('role-a')).rejects.toThrow('读取角色失败：HTTP 500')
  })
})

describe('通用实体权威读取：列表仲裁兜底', () => {
  const storageError = Object.assign(new Error('json file does not exist'), { code: 'storage.read_failed' })

  function createWorkspaceReader(netRequest: (req: any) => Promise<any>) {
    return createEntityAuthorityReader({
      netRequest,
      resourcePath: '/api/workspaces',
      entityLabel: '工作区',
      listFallback: { path: '/api/workspaces' },
    })
  }

  it('实体读取返回通用 storage.read_failed，但列表中没有该 id -> 视为不存在', async () => {
    const netRequest = vi.fn(async (req: any) => {
      if (String(req?.path) === '/api/workspaces') return { status: 200, body: [{ id: 'ws-other' }] }
      throw storageError
    })
    const readWorkspace = createWorkspaceReader(netRequest)

    await expect(readWorkspace('ws-missing')).resolves.toBeNull()
  })

  it('实体读取失败但列表仍包含该 id -> 原样抛出，交给上层标记未确认', async () => {
    const netRequest = vi.fn(async (req: any) => {
      if (String(req?.path) === '/api/workspaces') return { status: 200, body: [{ id: 'ws-1' }] }
      throw storageError
    })
    const readWorkspace = createWorkspaceReader(netRequest)

    await expect(readWorkspace('ws-1')).rejects.toBe(storageError)
  })

  it('列表读取也失败 -> 原样抛出原实体错误', async () => {
    const netRequest = vi.fn(async (req: any) => {
      if (String(req?.path) === '/api/workspaces') throw new Error('列表读取失败')
      throw storageError
    })
    const readWorkspace = createWorkspaceReader(netRequest)

    await expect(readWorkspace('ws-1')).rejects.toBe(storageError)
  })
})
