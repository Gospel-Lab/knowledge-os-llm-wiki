import fs from 'node:fs';
import path from 'node:path';
import { scanFolder } from '../vendor/scan.js';
import { extractMarkdown } from '../extract/markdown.js';
import { extractPdf } from '../extract/pdf.js';
import { extractDocx } from '../extract/docx.js';
import { extractPptx } from '../extract/pptx.js';

export async function extractOne(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md' || ext === '.markdown' || ext === '.txt') return extractMarkdown(filePath);
  if (ext === '.pdf') return extractPdf(filePath);
  if (ext === '.docx') return extractDocx(filePath);
  if (ext === '.pptx') return extractPptx(filePath);
  return null;
}

function fileSignature(filePath) {
  const st = fs.statSync(filePath);
  return `${st.size}:${Math.floor(st.mtimeMs)}`;
}

export async function extractFolder(root, { cache = null } = {}) {
  const files = scanFolder(root);
  const extracted = [];
  for (const filePath of files) {
    let result = null;
    const key = `extract:${filePath}`;
    if (cache) {
      const hit = cache.get(key);
      if (hit && hit.sig === fileSignature(filePath)) result = hit.result;
    }
    if (!result) {
      result = await extractOne(filePath);
      if (cache && result) cache.set(key, { sig: fileSignature(filePath), result });
    }
    if (result && result.body) extracted.push({ filePath, result });
  }
  return extracted;
}
