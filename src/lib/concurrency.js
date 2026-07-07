// 최대 limit개를 동시에 실행하되 결과는 입력 순서대로 돌려준다.
// 외부 의존성 없이 인덱스 워커 풀로 구현.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  const cap = Math.max(1, Math.min(limit || 1, items.length || 1));
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: cap }, () => worker()));
  return results;
}
