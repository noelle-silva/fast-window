import type { FwArgs } from './types'

export function parseFwArgs(argv: string[] = []): FwArgs {
  const args: FwArgs = {
    launched: false,
    action: 'toggle',
    mode: 'default',
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--fw-launched':
        args.launched = true
        break
      case '--fw-action':
        if (i + 1 < argv.length) {
          const v = argv[++i]
          if (v === 'toggle' || v === 'show' || v === 'hide' || v === 'close') {
            args.action = v
          }
        }
        break
      case '--fw-mode':
        if (i + 1 < argv.length) {
          const v = argv[++i]
          if (v === 'default' || v === 'window' || v === 'top') {
            args.mode = v
          }
        }
        break
      case '--fw-command':
        if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
          args.command = argv[++i]
        }
        break
      case '--fw-x':
        if (i + 1 < argv.length) {
          const v = parseInt(argv[++i], 10)
          if (!isNaN(v)) args.x = v
        }
        break
      case '--fw-y':
        if (i + 1 < argv.length) {
          const v = parseInt(argv[++i], 10)
          if (!isNaN(v)) args.y = v
        }
        break
      case '--fw-width':
        if (i + 1 < argv.length) {
          const v = parseInt(argv[++i], 10)
          if (!isNaN(v) && v > 0) args.width = v
        }
        break
      case '--fw-height':
        if (i + 1 < argv.length) {
          const v = parseInt(argv[++i], 10)
          if (!isNaN(v) && v > 0) args.height = v
        }
        break
    }
  }

  return args
}
