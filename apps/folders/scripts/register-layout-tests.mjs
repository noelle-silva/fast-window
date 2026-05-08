import { fileURLToPath, pathToFileURL } from 'node:url'
import { register } from 'node:module'

register('./ts-loader.mjs', pathToFileURL(`${fileURLToPath(new URL('.', import.meta.url))}/`))
