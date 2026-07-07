// 외부 NLP 라이브러리 없이 순수 JS로 만든 아주 단순한 TF-IDF 키워드 추출기.
// 형태소 분석은 하지 않는다 — 공백/구두점 기준 토큰화 + 불용어 제거 + 빈도 기반이라
// 완벽하진 않지만, "이 문서들은 비슷한 단어를 많이 공유한다"는 자동 링크 신호로는 충분하다.

const STOPWORDS = new Set([
  // 영어
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "is",
  "are", "was", "were", "be", "been", "with", "as", "by", "at", "this",
  "that", "it", "its", "from", "which", "will", "can", "not", "into", "your",
  "you", "we", "our", "their", "there", "these", "those", "also", "such",
  // 한국어 기능어 (조사 스트리핑 이후에도 남는 것들)
  "이", "그", "저", "것", "수", "등", "및", "때", "곳", "분", "안", "밖", "뒤", "앞",
  "그리고", "하지만", "그러나", "그래서", "그런데", "따라서", "때문", "위해", "대한",
  "대해", "통해", "있다", "없다", "한다", "하는", "된다", "되는", "되어", "있는",
  "없는", "같은", "같이", "위한", "라는", "이며", "이고", "부터", "까지", "경우",
  "정도", "이상", "이하", "관련", "각각", "모든", "여러", "다른", "다음", "지난",
  "우리", "여기", "거기", "누구", "무엇", "어떤", "어느", "매우", "가장", "더욱",
]);

// 어절 끝에서 떼어낼 조사 — 긴 것부터 매칭 (2자 조사가 1자 조사보다 먼저)
const JOSA = [
  "으로부터", "에서부터", "이라는", "에게서", "한테서", "으로서", "으로써",
  "에서는", "에서도", "에게는", "라는", "까지", "부터", "에서", "에게", "한테",
  "보다", "처럼", "마다", "으로", "와의", "과의", "이나", "이란", "이든",
  "은", "는", "이", "가", "을", "를", "의", "에", "도", "만", "와", "과", "로", "께", "야",
].sort((a, b) => b.length - a.length);

// 이 어미로 끝나는 한글 토큰은 서술어로 보고 통째로 버린다
const PREDICATE_ENDING_RE =
  /(습니다|입니다|합니다|됩니다|십시오|하세요|세요|어요|아요|에요|예요|았다|었다|였다|한다|된다|하다|되다|이다|하며|되며|하고|되고|하여|되어|해서|돼서|하면|되면|하지|되지|겠다|는다)$/;

const HANGUL_RE = /^[가-힣]+$/;

function stripJosa(token) {
  for (const josa of JOSA) {
    // 잔여가 2자 이상일 때만 스트리핑 → '종이', '교회' 같은 짧은 명사 보호
    if (token.length - josa.length >= 2 && token.endsWith(josa)) {
      return token.slice(0, -josa.length);
    }
  }
  return token;
}

export function tokenize(text) {
  const raw = text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  const out = [];
  for (let token of raw) {
    if (HANGUL_RE.test(token)) {
      if (PREDICATE_ENDING_RE.test(token)) continue; // 서술어 폐기
      token = stripJosa(token);
    }
    if (token.length < 2) continue;
    if (STOPWORDS.has(token)) continue;
    out.push(token);
  }
  return out;
}

export function extractKeywords(docs, topN = 8) {
  const docFreq = new Map();
  const termCounts = docs.map((body) => {
    const counts = new Map();
    for (const tok of tokenize(body)) counts.set(tok, (counts.get(tok) || 0) + 1);
    for (const term of counts.keys()) docFreq.set(term, (docFreq.get(term) || 0) + 1);
    return counts;
  });

  const n = docs.length;
  return termCounts.map((counts) => {
    const scored = [...counts.entries()].map(([term, tf]) => {
      const idf = Math.log((n + 1) / (docFreq.get(term) + 1)) + 1;
      return [term, tf * idf];
    });
    scored.sort((a, b) => b[1] - a[1]);
    return scored.slice(0, topN).map(([term]) => term);
  });
}

// 상위 키워드를 공유하는 문서끼리만 후보로 묶어(역색인) O(n^2) 전수비교를 피한다.
export function keywordSimilarityLinks(nodeIds, keywordSets, minShared = 2) {
  const inverted = new Map();
  keywordSets.forEach((kws, i) => {
    for (const kw of kws) {
      if (!inverted.has(kw)) inverted.set(kw, []);
      inverted.get(kw).push(i);
    }
  });

  const sharedCount = new Map();
  for (const idxList of inverted.values()) {
    for (let a = 0; a < idxList.length; a++) {
      for (let b = a + 1; b < idxList.length; b++) {
        const key = `${idxList[a]}:${idxList[b]}`;
        sharedCount.set(key, (sharedCount.get(key) || 0) + 1);
      }
    }
  }

  const links = [];
  for (const [key, count] of sharedCount.entries()) {
    if (count < minShared) continue;
    const [a, b] = key.split(":").map(Number);
    links.push({ source: nodeIds[a], target: nodeIds[b], kind: "similar" });
  }
  return links;
}
