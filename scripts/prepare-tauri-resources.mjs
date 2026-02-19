import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const srcPluginsDir = path.join(rootDir, "plugins");
const dstPluginsDir = path.join(rootDir, "src-tauri", "plugins");

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(srcPluginsDir))) return;

  await fs.rm(dstPluginsDir, { recursive: true, force: true });
  await fs.mkdir(dstPluginsDir, { recursive: true });
  await fs.cp(srcPluginsDir, dstPluginsDir, { recursive: true });
}

await main();

