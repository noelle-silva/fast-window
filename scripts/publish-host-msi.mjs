import process from 'node:process'
import { runHostPublishCli } from './lib/host-publish-cli.mjs'

await runHostPublishCli(process.argv, 'node scripts/publish-host-msi.mjs').catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
