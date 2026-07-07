// Obsidian 방식의 wikilink 해석: 경로 일치 > 파일명 일치 > 제목 일치.
// 파일명이 중복되면 file 경로 정렬상 첫 문서로 결정론적으로 해석한다.

export function normalizeWikilinkTarget(raw) {
  return String(raw || '').split('#')[0].split('^')[0].trim();
}

function stripExt(relPath) {
  return relPath.replace(/\.[^./]+$/, '');
}

// macOS 파일시스템은 파일명을 NFD로 정규화해 반환할 수 있는 반면, 마크다운 본문의
// 위키링크 타깃 텍스트는 보통 NFC다. 시각적으로 동일한 문자열이 Map lookup에서
// 어긋나지 않도록 키 생성/조회 시 항상 NFC로 정규화한 뒤 소문자로 비교한다.
function normKey(value) {
  return String(value || '').normalize('NFC').toLowerCase();
}

export function buildLinkResolver(docs) {
  const byRel = new Map();
  const byBase = new Map();
  const byTitle = new Map();
  const sorted = [...docs].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  for (const doc of sorted) {
    const relNoExt = normKey(stripExt(doc.file));
    if (!byRel.has(relNoExt)) byRel.set(relNoExt, doc.id);
    const base = relNoExt.split('/').pop();
    if (!byBase.has(base)) byBase.set(base, doc.id);
    const title = normKey(doc.title);
    if (title && !byTitle.has(title)) byTitle.set(title, doc.id);
  }
  return (rawTarget) => {
    const target = normKey(normalizeWikilinkTarget(rawTarget));
    if (!target) return null;
    return byRel.get(target) ?? byBase.get(target) ?? byTitle.get(target) ?? null;
  };
}
