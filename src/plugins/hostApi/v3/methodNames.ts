export const V3_METHOD = {
  host: {
    back: 'host.back',
    getInfo: 'host.getInfo',
    toast: 'host.toast',
    activatePlugin: 'host.activatePlugin',
  },
  process: {
    openExternalUrl: 'process.openExternalUrl',
    openExternalUri: 'process.openExternalUri',
    openBrowserWindow: 'process.openBrowserWindow',
    run: 'process.run',
    spawn: 'process.spawn',
    kill: 'process.kill',
    wait: 'process.wait',
  },
  task: {
    create: 'task.create',
    get: 'task.get',
    list: 'task.list',
    cancel: 'task.cancel',
  },
  workspace: {
    getPaths: 'workspace.getPaths',
    openOutputDir: 'workspace.openOutputDir',
    openDir: 'workspace.openDir',
  },
  dialog: {
    pickDir: 'dialog.pickDir',
    pickOutputDir: 'dialog.pickOutputDir',
    pickLibraryDir: 'dialog.pickLibraryDir',
    pickImages: 'dialog.pickImages',
    confirm: 'dialog.confirm',
  },
  clipboard: {
    readText: 'clipboard.readText',
    writeText: 'clipboard.writeText',
    readImageDataUrl: 'clipboard.readImageDataUrl',
    writeImageDataUrl: 'clipboard.writeImageDataUrl',
    watch: 'clipboard.watch',
    getWatch: 'clipboard.getWatch',
    unwatch: 'clipboard.unwatch',
  },
} as const
