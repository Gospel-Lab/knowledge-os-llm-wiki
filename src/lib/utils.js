import fs from 'node:fs';
import path from 'node:path';

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const [key, maybeValue] = token.slice(2).split('=', 2);
    if (maybeValue !== undefined) {
      args[key] = maybeValue;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function slugify(value) {
  return (String(value || '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .toLowerCase()
    .normalize('NFC')) || 'untitled';
}

// 같은 ingest 안에서 slug 유일성을 보장한다.
// scanFolder가 파일을 정렬해 주므로 suffix 부여 순서도 결정론적이다.
export function createSlugger() {
  const used = new Map();
  return (value) => {
    const base = slugify(value);
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };
}

export function cleanText(text = '') {
  return String(text).replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();
}

export function excerpt(text, maxChars = 280) {
  const cleaned = cleanText(text);
  return cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, maxChars - 1)}…`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

export function tokenizeQuery(value) {
  return cleanText(value)
    .toLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu) || [];
}

export function scoreByTokenOverlap(question, candidates, fields) {
  const tokens = tokenizeQuery(question);
  if (!tokens.length) return candidates.map((item) => ({ item, score: 0 }));
  return candidates.map((item) => {
    const haystack = fields.map((field) => cleanText(item[field] || '')).join(' ').toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) score += 1;
    }
    return { item, score };
  }).sort((a, b) => b.score - a.score);
}
