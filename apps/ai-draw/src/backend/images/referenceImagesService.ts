import type { ImageStore } from './imageStore'

export function createReferenceImagesService(store: ImageStore) {
  return {
    list: async () => ({ paths: await store.list() }),
    read: async (params: any) => ({ dataUrl: await store.read(String(params?.path || '')) }),
    saveBase64: async (params: any) => ({ savedPath: await store.saveBase64(String(params?.dataUrlOrBase64 || '')) }),
    delete: async (params: any) => {
      await store.delete(String(params?.path || ''))
      return null
    },
  }
}
