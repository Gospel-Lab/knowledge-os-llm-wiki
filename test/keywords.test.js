import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, extractKeywords } from '../src/vendor/keywords.js';
import { defaultMaxConcepts } from '../src/lib/wiki-builder.js';

test('tokenize: 조사가 제거되어 같은 명사로 합쳐진다', () => {
  const tokens = tokenize('하나님은 사랑이시다. 하나님의 사랑, 하나님이 하신 일, 하나님을 찬양');
  const counts = tokens.filter((t) => t === '하나님').length;
  assert.equal(counts, 4);
  assert.ok(!tokens.includes('하나님은'));
  assert.ok(!tokens.includes('하나님의'));
});

test('tokenize: 서술어 토큰은 버려진다', () => {
  const tokens = tokenize('이것은 중요합니다. 그것이 핵심입니다. 반드시 확인했습니다. 될 것입니다');
  assert.ok(!tokens.includes('중요합니다'));
  assert.ok(!tokens.includes('핵심입니다'));
  assert.ok(!tokens.includes('확인했습니다'));
  assert.ok(!tokens.includes('것입니다'));
});

test('tokenize: 모음 어간 ㅂ니다-활용 서술어도 버려진다', () => {
  const tokens = tokenize('은혜를 드립니다. 물이 넘칩니다. 학교에 갑니다. 정말 그렇습니까? 어디로 갑니까?');
  assert.ok(!tokens.includes('드립니다'));
  assert.ok(!tokens.includes('넘칩니다'));
  assert.ok(!tokens.includes('갑니다'));
  assert.ok(!tokens.includes('그렇습니까'));
  assert.ok(!tokens.includes('갑니까'));
});

test('tokenize: "이는"은 불용어로 제거된다', () => {
  const tokens = tokenize('이는 매우 중요한 사실이다');
  assert.ok(!tokens.includes('이는'));
});

test('tokenize: NFD로 입력해도 NFC 결과와 동일하다', () => {
  assert.deepEqual(tokenize('하나님의 은혜'.normalize('NFD')), tokenize('하나님의 은혜'));
});

test('tokenize: 짧은 명사는 과잉 스트리핑하지 않는다', () => {
  // '교회'에서 '회'를 조사로 오인해 '교'만 남기면 안 된다 (잔여 2자 미만 보호)
  const tokens = tokenize('교회 종이 울린다');
  assert.ok(tokens.includes('교회'));
  assert.ok(tokens.includes('종이') || tokens.includes('종')); // '종이'는 잔여 1자라 스트리핑 안 함
});

test('extractKeywords: 한국어 문서에서 명사형 키워드가 뽑힌다', () => {
  const docs = [
    '하나님은 사랑입니다. 하나님의 은혜가 임합니다. 예배를 드립니다.',
    '하나님이 창조하셨습니다. 은혜로 구원을 받습니다. 예배가 중요합니다.',
  ];
  const [kw1, kw2] = extractKeywords(docs, 5);
  assert.ok(kw1.includes('하나님'));
  assert.ok(kw2.includes('하나님'));
  assert.ok(!kw1.some((k) => /습니다$|입니다$/.test(k)));
});

test('defaultMaxConcepts: 문서 수에 비례하되 14~80으로 클램프', () => {
  assert.equal(defaultMaxConcepts(7), 14);    // 소규모: 기존 동작 유지
  assert.equal(defaultMaxConcepts(100), 30);  // sqrt(100)*3
  assert.equal(defaultMaxConcepts(700), 79);  // round(sqrt(700)*3)
  assert.equal(defaultMaxConcepts(10000), 80); // 상한
});
