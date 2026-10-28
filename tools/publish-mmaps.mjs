#!/usr/bin/env node
// Signs the list of the bots' navigation maps we publish (2.8.1 on): a new server downloads them instead of building
// them for hours. The folder comes from the assembler of a reference server:
//   Runtime\python\python.exe -B Assembler\coa_assemble.py --json mmaps-pack --out <folder> --version 2.8.1
//   node tools/publish-mmaps.mjs <folder> --key keys/squidbots-release.private.pem
// Writes <folder>/manifest.json again with manifest.json.sig, after checking every zip against it. Upload the zips
// first, the manifest (and its .sig) last, to the release given by server.mmapsUrl of the launcher.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs, loadPrivateKey, writeSigned } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), {});
const [folder] = args._;
if (!folder || !args.key) {
  console.log('Usage: node tools/publish-mmaps.mjs <mmaps-pack folder> --key <private.pem>');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
if (manifest.format !== 1 || !manifest.version || !manifest.maps) { console.error('manifest.json is not a list of navigation maps.'); process.exit(1); }
let bytes = 0;
for (const [id, entry] of Object.entries(manifest.maps)) {
  const file = path.join(folder, path.basename(entry.file));
  if (!fs.existsSync(file)) { console.error(`Map ${id}: ${entry.file} is missing.`); process.exit(1); }
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== entry.sha256 || fs.statSync(file).size !== entry.size) { console.error(`Map ${id}: ${entry.file} does not match the list.`); process.exit(1); }
  bytes += entry.size;
}
await writeSigned(path.join(folder, 'manifest.json'), manifest, loadPrivateKey(args.key));
console.log(`Navigation maps ${manifest.version}: ${Object.keys(manifest.maps).length} maps, ${(bytes / 1e9).toFixed(2)} GB, manifest signed.`);
