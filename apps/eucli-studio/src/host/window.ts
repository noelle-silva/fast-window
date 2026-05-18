export function createWindowApi(tauri: any, toast: (message: any) => void) {
  return {
    startDragging: async () => {
      try {
        await tauri.invoke({ command: 'plugin:window|start_dragging', payload: {} })
      } catch (e) {
        toast(String((e as any)?.message || e || '无法拖拽'))
      }
    },
  }
}
