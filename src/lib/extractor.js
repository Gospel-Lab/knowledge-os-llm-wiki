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

export async function extractFolder(root) {
  const files = scanFolder(root);
  const extracted = [];
  for (const filePath of files) {
    const result = await extractOne(filePath);
    if (result && result.body) extracted.push({ filePath, result });
  }
  return extracted;
}
