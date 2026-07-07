import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'assets');
export const VENDOR_FILES = ['three.min.js', '3d-force-graph.min.js', 'marked.min.js', 'fuse.min.js', 'purify.min.js'];

export function vendorAssetsDir() { return ASSETS_DIR; }

export function copyVendorAssets(destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of VENDOR_FILES) {
    fs.copyFileSync(path.join(ASSETS_DIR, name), path.join(destDir, name));
  }
}
