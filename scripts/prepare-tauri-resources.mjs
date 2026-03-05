import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const srcPluginsDir = path.join(rootDir, "plugins");
const dstSeedsDir = path.join(rootDir, "src-tauri", "plugin-seeds");
const dstLegacyPluginsDir = path.join(rootDir, "src-tauri", "plugins");

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function normalizeRel(p) {
  return String(p || "").trim().replaceAll("\\", "/");
}

function assertSafeRel(rel, what) {
  const r = normalizeRel(rel);
  if (!r) throw new Error(`Invalid ${what}: empty`);
  if (path.isAbsolute(r)) throw new Error(`Invalid ${what}: must be relative: ${r}`);
  const parts = r.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === "..") {
      throw new Error(`Invalid ${what}: unsafe path: ${r}`);
    }
  }
  return r;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function copyFile(srcBase, dstBase, rel) {
  const r = normalizeRel(rel);
  const src = path.join(srcBase, r);
  const dst = path.join(dstBase, r);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
}

function collectReferencedFiles(manifest) {
  const out = new Set();
  out.add("manifest.json");

  const main = assertSafeRel(manifest?.main, "manifest.main");
  out.add(main);

  const bgMain = normalizeRel(manifest?.background?.main);
  if (bgMain && bgMain !== main) {
    out.add(assertSafeRel(bgMain, "manifest.background.main"));
  }

  // 插件图标：只支持打包 svg（manifest.icon = "svg:<rel>.svg"）
  const icon = normalizeRel(manifest?.icon);
  if (icon.startsWith("svg:")) {
    const rel = icon.slice("svg:".length).trim();
    if (rel && rel.toLowerCase().endsWith(".svg")) {
      out.add(assertSafeRel(rel, "manifest.icon"));
    }
  }

  return Array.from(out);
}

async function main() {
  if (!(await exists(srcPluginsDir))) return;

  // 种子资源目录：用于随包打进安装包 resources（避免与运行时 plugins/ 目录重名导致便携模式冲突）
  await fs.rm(dstSeedsDir, { recursive: true, force: true });
  await fs.mkdir(dstSeedsDir, { recursive: true });

  // 清理旧目录（历史遗留）
  await fs.rm(dstLegacyPluginsDir, { recursive: true, force: true });

  const entries = await fs.readdir(srcPluginsDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const pluginId = ent.name;
    if (!pluginId || pluginId.startsWith(".")) continue;

    const pluginSrcDir = path.join(srcPluginsDir, pluginId);
    const pluginDstDir = path.join(dstSeedsDir, pluginId);
    const manifestPath = path.join(pluginSrcDir, "manifest.json");
    if (!(await exists(manifestPath))) continue;

    const manifest = await readJson(manifestPath);
    const files = collectReferencedFiles(manifest);

    await fs.mkdir(pluginDstDir, { recursive: true });
    for (const rel of files) {
      await copyFile(pluginSrcDir, pluginDstDir, rel);
    }
  }
}

await main();

