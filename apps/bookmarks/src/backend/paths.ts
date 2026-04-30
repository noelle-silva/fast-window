import { join } from 'node:path'

export function resolveDataFilePath(env = process.env) {
  const dataDir = env.FW_APP_DATA_DIR || join(process.cwd(), 'data')
  return join(dataDir, 'data.json')
}
