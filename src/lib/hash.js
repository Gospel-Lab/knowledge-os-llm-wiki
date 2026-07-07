import { createHash } from 'node:crypto';

// 콘텐츠를 NFC로 정규화한 뒤 sha1 — 증분 판단·캐시 키·안정 식별자에 쓴다.
export function contentHash(text) {
  return createHash('sha1').update(String(text || '').normalize('NFC'), 'utf8').digest('hex');
}
