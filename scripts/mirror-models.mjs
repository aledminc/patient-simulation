import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "public", "model-manifest.json"), "utf8"));
const destinationRoot = resolve(process.argv[2] || resolve(root, ".model-mirror"));
const versionRoot = resolve(destinationRoot, manifest.version);

async function digestFile(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.byteLength;
  }
  return { bytes, sha256: hash.digest("hex") };
}

async function validExisting(path, asset) {
  try {
    const info = await stat(path);
    if (info.size !== asset.size) return false;
    return (await digestFile(path)).sha256 === asset.sha256;
  } catch {
    return false;
  }
}

async function download(asset) {
  const destination = resolve(versionRoot, asset.localPath);
  if (await validExisting(destination, asset)) {
    console.log(`verified ${asset.localPath}`);
    return;
  }

  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.partial`;
  await rm(temporary, { force: true });
  const response = await fetch(asset.sourceUrl, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} downloading ${asset.localPath}`);
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: "wx" }));
    const digest = await digestFile(temporary);
    if (digest.bytes !== asset.size || digest.sha256 !== asset.sha256) {
      throw new Error(`Integrity mismatch for ${asset.localPath}`);
    }
    await rm(destination, { force: true });
    await rename(temporary, destination);
    console.log(`downloaded ${asset.localPath}`);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

await mkdir(versionRoot, { recursive: true });
for (const model of manifest.models) {
  for (const asset of model.assets) await download(asset);
}
await writeFile(resolve(versionRoot, "model-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Verified model mirror ready at ${versionRoot}`);
