import { describe, expect, it } from 'vitest'
import {
  ASSET_UPLOAD_TASK_VIEWS,
  clampUploadProgress,
  filterUploadTasksByView,
  formatUploadBytes,
  isActiveUploadTask,
  isCompletedUploadTask,
  isFailedUploadTask,
  isPollingUploadTask,
  mergeUploadTasks,
  sortUploadTasks,
  uploadTaskError,
  uploadTaskStatusText,
  uploadTaskTitle,
  uploadTaskViewEmptyText,
  uploadTaskViewLabel,
  upsertUploadTask,
  type AssetUploadTaskView,
} from './assetUploadTasks'
import type { AssetUploadFileSnapshot, AssetUploadTaskSnapshot, AssetUploadTaskStatus } from '../gateway/types'

function task(over: Partial<AssetUploadTaskSnapshot> = {}): AssetUploadTaskSnapshot {
  return {
    id: 't1',
    scope: 'library',
    status: 'queued',
    files: [],
    totalBytes: 0,
    uploadedBytes: 0,
    progress: 0,
    createdMs: 100,
    updatedMs: 100,
    ...over,
  }
}

function file(over: Partial<AssetUploadFileSnapshot> = {}): AssetUploadFileSnapshot {
  return {
    id: 'f',
    name: 'a',
    path: 'a',
    size: 0,
    uploadedBytes: 0,
    progress: 0,
    status: 'pending',
    ...over,
  }
}

describe('view constants', () => {
  it('lists the three views in order', () => {
    expect(ASSET_UPLOAD_TASK_VIEWS).toEqual(['active', 'failed', 'completed'])
  })
})

describe('task status classification', () => {
  const rows: Array<[AssetUploadTaskStatus, boolean, boolean, boolean, boolean]> = [
    ['queued', true, false, false, true],
    ['running', true, false, false, true],
    ['paused', true, false, false, false],
    ['completed', false, false, true, false],
    ['failed', false, true, false, false],
    ['canceled', false, false, true, false],
  ]

  it.each(rows)('classifies %s', (status, active, failed, completed, polling) => {
    const t = task({ status })
    expect(isActiveUploadTask(t)).toBe(active)
    expect(isFailedUploadTask(t)).toBe(failed)
    expect(isCompletedUploadTask(t)).toBe(completed)
    expect(isPollingUploadTask(t)).toBe(polling)
  })
})

describe('filterUploadTasksByView', () => {
  const tasks = [
    task({ id: 'a', status: 'running', createdMs: 10 }),
    task({ id: 'b', status: 'failed', createdMs: 30 }),
    task({ id: 'c', status: 'completed', createdMs: 20 }),
  ]

  it.each([
    ['active', ['a']],
    ['failed', ['b']],
    ['completed', ['c']],
  ] as Array<[AssetUploadTaskView, string[]]>)('filters %s', (view, expected) => {
    expect(filterUploadTasksByView(tasks, view).map(t => t.id)).toEqual(expected)
  })
})

describe('view labels', () => {
  it.each([
    ['active', '上传中', '没有正在上传的任务'],
    ['failed', '失败', '没有失败的任务'],
    ['completed', '已完成', '还没有完成的任务'],
  ] as Array<[AssetUploadTaskView, string, string]>)('labels %s', (view, label, empty) => {
    expect(uploadTaskViewLabel(view)).toBe(label)
    expect(uploadTaskViewEmptyText(view)).toBe(empty)
  })
})

describe('upsertUploadTask', () => {
  it('prepends a new task and keeps the newest-first order', () => {
    expect(upsertUploadTask([task({ id: 'x', createdMs: 5 })], task({ id: 'y', createdMs: 9 })).map(t => t.id)).toEqual(['y', 'x'])
  })

  it('replaces an existing task in place and re-sorts', () => {
    const result = upsertUploadTask(
      [task({ id: 'x', createdMs: 5 }), task({ id: 'y', createdMs: 9 })],
      task({ id: 'x', createdMs: 5, status: 'running' }),
    )
    expect(result.map(t => [t.id, t.status])).toEqual([['y', 'queued'], ['x', 'running']])
  })
})

describe('mergeUploadTasks', () => {
  it('lets incoming tasks win by id and sorts newest-first', () => {
    const result = mergeUploadTasks(
      [task({ id: 'x', createdMs: 1 })],
      [task({ id: 'x', createdMs: 2, status: 'running' }), task({ id: 'y', createdMs: 3 })],
    )
    expect(result.map(t => [t.id, t.status, t.createdMs])).toEqual([['y', 'queued', 3], ['x', 'running', 2]])
  })
})

describe('sortUploadTasks', () => {
  it('sorts by createdMs descending and does not mutate the input', () => {
    const input = [task({ id: 'a', createdMs: 0 }), task({ id: 'b', createdMs: 5 }), task({ id: 'c', createdMs: 5 })]
    expect(sortUploadTasks(input).map(t => t.id)).toEqual(['b', 'c', 'a'])
    expect(input.map(t => t.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('formatUploadBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1048576, '1.0 MB'],
    [1073741824, '1.0 GB'],
    [2147483648, '2.0 GB'],
  ])('formats %s bytes as %s', (bytes, expected) => {
    expect(formatUploadBytes(bytes)).toBe(expected)
  })
})

describe('clampUploadProgress', () => {
  it.each([
    [-5, 0],
    [0, 0],
    [50, 50],
    [100, 100],
    [150, 100],
    [NaN, 0],
    ['x', 0],
  ])('clamps %s to %s', (progress, expected) => {
    expect(clampUploadProgress(progress as number)).toBe(expected)
  })
})

describe('uploadTaskStatusText', () => {
  it.each([
    ['queued', '等待中'],
    ['running', '上传中'],
    ['paused', '已暂停'],
    ['completed', '已完成'],
    ['failed', '出错'],
    ['canceled', '已取消'],
  ] as Array<[AssetUploadTaskStatus, string]>)('labels %s as %s', (status, expected) => {
    expect(uploadTaskStatusText(task({ status }))).toBe(expected)
  })

  it('labels an unknown status', () => {
    expect(uploadTaskStatusText(task({ status: 'bogus' as AssetUploadTaskStatus }))).toBe('未知')
  })
})

describe('uploadTaskTitle', () => {
  it('reports the count when there is no single file', () => {
    expect(uploadTaskTitle(task({ files: [] }))).toBe('0 个附件')
  })

  it('uses the file name when there is exactly one file', () => {
    expect(uploadTaskTitle(task({ files: [file({ name: 'a.png' })] }))).toBe('a.png')
  })

  it('falls back to 附件上传 for a single unnamed file', () => {
    expect(uploadTaskTitle(task({ files: [file({ name: '' })] }))).toBe('附件上传')
  })

  it('reports the count for multiple files', () => {
    expect(uploadTaskTitle(task({ files: [file({ id: 'f1', name: 'a' }), file({ id: 'f2', name: 'b' })] }))).toBe('2 个附件')
  })
})

describe('uploadTaskError', () => {
  it('prefers the task-level error', () => {
    expect(uploadTaskError(task({ error: 'boom', files: [file({ status: 'failed', error: 'file' })] }))).toBe('boom')
  })

  it('falls back to the first file error', () => {
    expect(uploadTaskError(task({ files: [file({ status: 'failed', error: 'file' })] }))).toBe('file')
  })

  it('returns an empty string when there is no error', () => {
    expect(uploadTaskError(task())).toBe('')
  })
})
