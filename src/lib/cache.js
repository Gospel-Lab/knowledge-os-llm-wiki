import fs from 'node:fs';
import path from 'node:path';

// 단순 JSON KV 캐시. 손상 파일은 빈 캐시로 시작한다(치명적 실패 아님).
export function createCache(filePath) {
  let store = {};
  try {
    store = JSON.parse(fs.readFileSync(filePath, 'utf-8')) || {};
    if (typeof store !== 'object' || Array.isArray(store)) store = {};
  } catch {
    store = {};
  }
  return {
    get(key) { return store[key]; },
    set(key, value) { store[key] = value; },
    save() {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
    },
  };
}
