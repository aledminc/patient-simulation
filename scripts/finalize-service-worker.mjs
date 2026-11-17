import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const pagesFileLimit = 25 * 1024 * 1024;

// ONNX Runtime's generic browser bundle emits this default fallback even though
// both speech workers set wasmPaths to the smaller, pinned /ort runtime.
for (const entry of await readdir(resolve(dist, "assets"))) {
  if (/^ort-wasm-simd-threaded\.asyncify-.*\.wasm$/.test(entry)) {
    await rm(resolve(dist, "assets", entry));
  }
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else files.push(path);
  }
  return files;
}

const allFiles = await filesBelow(dist);
for (const path of allFiles) {
  const info = await stat(path);
  if (info.size > pagesFileLimit) {
    throw new Error(`${relative(dist, path)} is ${info.size} bytes; Cloudflare Pages permits at most ${pagesFileLimit} bytes per asset.`);
  }
}
const shell = allFiles
  .filter(path => !path.endsWith("sw.js") && !path.endsWith(".map") && !path.endsWith("_headers") && !path.endsWith("_redirects"))
  .map(path => `/${relative(dist, path).split(sep).join("/")}`)
  .sort();
if (!shell.includes("/index.html")) throw new Error("Production build has no index.html");

const workerPath = resolve(dist, "sw.js");
let worker = await readFile(workerPath, "utf8");
worker = worker.replace("/* APP_SHELL_MANIFEST */ []", JSON.stringify(shell));
const versionHash = createHash("sha256");
for (const url of shell) {
  versionHash.update(url);
  versionHash.update(await readFile(resolve(dist, url.slice(1))));
}
const version = versionHash.digest("hex").slice(0, 12);
worker = worker.replace("patient-simulator-app-v1", `patient-simulator-app-${version}`);
await writeFile(workerPath, worker, "utf8");
console.log(`Finalized service worker ${version} with ${shell.length} precached files.`);
