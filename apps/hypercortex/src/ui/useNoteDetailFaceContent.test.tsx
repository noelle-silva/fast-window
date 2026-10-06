// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FaceContentStore } from '../facePlugins'
import type { NoteDetailFaceContent } from './useNoteDetailFaceContent'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// 面插件链在模块加载期会读取 window.matchMedia：jsdom 不提供，先补桩再动态加载被测模块。
let useNoteDetailFaceContent: typeof import('./useNoteDetailFaceContent').useNoteDetailFaceContent

beforeAll(async () => {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }
  ;({ useNoteDetailFaceContent } = await import('./useNoteDetailFaceContent'))
})

function fakeStore(content: string, saved: string): FaceContentStore {
  return {
    getContent: () => content,
    setContent: () => {},
    subscribe: () => () => {},
    reset: () => {},
    isDirty: () => content !== saved,
  }
}

function Harness(props: { apiRef: React.MutableRefObject<NoteDetailFaceContent | null> }) {
  const noop = () => {}
  const api = useNoteDetailFaceContent({
    gateway: {} as any,
    scope: 'library',
    noteId: 'n1',
    isDraft: true,
    noteDir: '',
    init: null,
    editing: false,
    face: 'f1',
    faces: ['f1'],
    faceManifests: {},
    baseFields: { title: '', description: '', tags: [], resources: [] },
    editTitle: '',
    editDescription: '',
    editTags: [],
    editResources: [],
    noteTimes: { createdAtMs: 1, updatedAtMs: 1 },
    tagInput: '',
    faceViewState: {},
    infoSidebarVisible: false,
    globalFaceKindOrder: [],
    saving: false,
    deleting: '',
    onSaved: noop as any,
    onVersionConflict: noop,
    applyNoteManifest: noop as any,
    resetFaceViewState: noop,
    setBaseFields: noop as any,
    setNoteTimes: noop as any,
    setEditTitle: noop as any,
    setEditDescription: noop as any,
    setEditTags: noop as any,
    setEditResources: noop as any,
    setFaceManifests: noop as any,
    setFaces: noop as any,
    setFace: noop as any,
    setTagInput: noop as any,
    setAddFaceSelectorVisible: noop as any,
    setPendingAddFace: noop as any,
    setEditing: noop as any,
    setSaving: noop as any,
  })
  props.apiRef.current = api
  return null
}

// 采用外部版本会整体替换面内容存储；替换后 facesDirty 必须重算，否则脏状态滞留。
describe('useNoteDetailFaceContent.replaceFaceStores', () => {
  let container: HTMLDivElement
  let root: Root
  const apiRef: React.MutableRefObject<NoteDetailFaceContent | null> = { current: null }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('替换为干净存储后脏状态清除，替换为脏存储后脏状态点亮', () => {
    act(() => {
      root.render(<Harness apiRef={apiRef} />)
    })
    expect(apiRef.current?.facesDirty).toBe(false)

    // 用户编辑：存储变脏。
    act(() => {
      apiRef.current!.replaceFaceStores({ f1: fakeStore('edited', 'saved') }, { f1: 'saved' })
    })
    expect(apiRef.current?.facesDirty).toBe(true)

    // 采用外部版本：替换为干净存储，脏状态必须随之清除。
    act(() => {
      apiRef.current!.replaceFaceStores({ f1: fakeStore('external', 'external') }, { f1: 'external' })
    })
    expect(apiRef.current?.facesDirty).toBe(false)
  })
})
