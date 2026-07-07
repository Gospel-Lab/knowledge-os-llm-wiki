// Obsidian 방식의 wikilink 해석: 경로 일치 > 파일명 일치 > 제목 일치.
// 파일명이 중복되면 file 경로 정렬상 첫 문서로 결정론적으로 해석한다.

export function normalizeWikilinkTarget(raw) {
  return String(raw || '').split('#')[0].split('^')[0].trim();
}

function stripExt(relPath) {
  return relPath.replace(/\.[^./]+$/, '');
}

export function buildLinkResolver(docs) {
  const byRel = new Map();
  const byBase = new Map();
  const byTitle = new Map();
  const sorted = [...docs].sort((a, b) => a.file.localeCompare(b.file));
  for (const doc of sorted) {
    const relNoExt = stripExt(doc.file).toLowerCase();
    if (!byRel.has(relNoExt)) byRel.set(relNoExt, doc.id);
    const base = relNoExt.split('/').pop();
    if (!byBase.has(base)) byBase.set(base, doc.id);
    const title = String(doc.title || '').toLowerCase();
    if (title && !byTitle.has(title)) byTitle.set(title, doc.id);
  }
  return (rawTarget) => {
    const target = normalizeWikilinkTarget(rawTarget).toLowerCase();
    if (!target) return null;
    return byRel.get(target) ?? byBase.get(target) ?? byTitle.get(target) ?? null;
  };
}
