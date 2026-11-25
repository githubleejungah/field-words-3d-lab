// tower.js 시험 — 코드 탑 칸 모양 · 장면 고르기 · 장식 (AC-44a~44t, flows 14장)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellShape, isHalfRepaired, towerTiers, shapeCounts, sceneFor, cheerFor, updateTower, sanitizeTower, hasBigScene, bigLines, lanternRow, meaningFor, whenText, ENCOURAGE, pickEncourage, SHAPE_NAMES, TIER_NAMES } from '../site/js/tower.js';

const rec = (box, extra = {}) => ({ box, status: 'known', history: [{}], ...extra });
const probs = (spec) => spec.flatMap(([level, n]) => Array.from({ length: n }, (_, i) => ({ id: `p${level}-${i}`, level })));

test('칸 모양 5가지와 글자 이름: 익히면 황금 벽돌, 상자 8은 빛나는 황금 벽돌 (AC-44e · 44e1 · 44e2 · 44f, ADR-0008)', () => {
  assert.equal(cellShape(null), 'empty');
  assert.equal(cellShape({ box: 0, status: null, history: [] }), 'empty');      // ①만 보고 답하지 않음
  assert.equal(cellShape(rec(1)), 'rough');
  assert.equal(cellShape(rec(3)), 'rough');
  assert.equal(cellShape(rec(4)), 'gold');                                      // 익힘 경계 → 황금 벽돌
  assert.equal(cellShape(rec(7)), 'gold');
  assert.equal(cellShape(rec(8)), 'gilt');
  assert.equal(cellShape(rec(8, { mis: { line: 1, streak: 0 } })), 'cracked');  // 착각이 먼저
  assert.deepEqual(Object.values(SHAPE_NAMES), ['빈칸', '거친 돌', '황금 벽돌', '빛나는 황금 벽돌', '금 간 돌']);
});

test('결과 뜻은 상태 5개마다 1줄, 다시 나오는 날을 넣고 규칙 글은 없다 (AC-44a · 44u · 71)', () => {
  for (const st of ['known', 'shaky', 'confused', 'misconception', 'unknown']) {
    const line = meaningFor(st, 4);
    assert.match(line, /이 문제는 4일 뒤에 다시 나와/);
    assert.ok(!/상자|간격/.test(line));
  }
  assert.match(meaningFor('known', 1), /이 문제는 내일 다시 나와요/);
  assert.equal(whenText(null), '곧');
  assert.equal(whenText(0), '곧');
  assert.equal(meaningFor('nope', 1), '');
});

test('응원은 헷갈림 · 착각 · 모름마다 2개 이상, 바로 전과 다른 문장 (AC-13f~13h)', () => {
  for (const st of ['misconception', 'confused', 'unknown']) {
    assert.ok(ENCOURAGE[st].length >= 2);
    for (const last of ENCOURAGE[st]) for (const r of [0, 0.5, 0.999]) {
      const pick = pickEncourage(st, last, r);
      assert.ok(ENCOURAGE[st].includes(pick));
      assert.notEqual(pick, last);
    }
  }
  assert.equal(pickEncourage('known', null, 0), null);   // 맞힌 결과에는 응원 줄 없음
});

test('등급마다 한 단, 칸 순서는 데이터 순서, 보수 1/2 표시 (AC-44c · 44d · 44q)', () => {
  const ps = probs([[1, 2], [2, 1], [4, 1]]);
  const tiers = towerTiers(ps, { 'p1-1': rec(4), 'p2-0': rec(2, { mis: { line: 0, streak: 1 } }) });
  assert.deepEqual(tiers.map((t) => t.name), ['기단', '1층', '2층', '3층']);
  assert.deepEqual(tiers[0].cells.map((c) => c.shape), ['empty', 'gold']);
  assert.equal(tiers[1].cells[0].shape, 'cracked');
  assert.equal(tiers[1].cells[0].half, true);
  assert.equal(tiers[2].cells.length, 0);
  assert.deepEqual(shapeCounts(tiers), { empty: 2, rough: 0, gold: 1, gilt: 0, cracked: 1 });
  assert.equal(TIER_NAMES[1], '기단');
  assert.equal(isHalfRepaired(rec(1, { mis: { line: 0, streak: 0 } })), false);
});

test('작은 장면은 전후 칸 모양으로 1개 고른다 (flows 14-2, AC-44g · 44r · 44s)', () => {
  const mis0 = { line: 0, streak: 0 }, mis1 = { line: 0, streak: 1 };
  const k = (b, a) => sceneFor(b, a).kind;
  assert.equal(k(rec(1, { mis: mis1 }), rec(1)), 'repair');
  assert.equal(k(null, rec(1, { mis: mis0 })), 'place-crack');
  assert.equal(k(null, rec(1)), 'place');
  assert.equal(k(rec(5), rec(3, { mis: mis0 })), 'crack');
  assert.equal(k(rec(3), rec(4)), 'harden');
  assert.equal(k(rec(7), rec(8)), 'gild');
  assert.equal(k(rec(5), rec(3)), 'drop');
  assert.equal(k(rec(1, { mis: mis0 }), rec(1, { mis: mis1 })), 'half');
  assert.equal(k(rec(1, { mis: mis1 }), rec(1, { mis: mis1 })), 'shine');
  assert.equal(k(rec(2), rec(3)), 'shine');
  assert.equal(k(null, { box: 0, status: null, history: [] }), 'shine');       // 답 없이 끝난 판
});

test('응원 1줄: 흔들림은 "다시 맞히면 돌아와요", 보수는 착각을 고쳤다고 (AC-44b · 44r · 44s)', () => {
  assert.match(cheerFor({ kind: 'drop' }).cheer, /다시 맞히면 돌아와요/);
  assert.match(cheerFor({ kind: 'repair' }).cheer, /착각 하나를 고쳤어요/);
  assert.equal(cheerFor({ kind: 'place' }, { tierName: '기단', filled: 3, total: 6 }).sub, '기단 3 / 6칸');
  assert.equal(cheerFor({ kind: 'shine' }, { nextDays: 4 }).sub, '다음 복습은 4일 뒤예요.');
  assert.equal(cheerFor({ kind: 'shine' }, {}).sub, '');
  assert.match(cheerFor({ kind: 'harden' }).cheer, /황금 벽돌을 놓았어요/);   // 거친 돌 → 황금 벽돌 (ADR-0008)
  assert.match(cheerFor({ kind: 'gild' }).cheer, /황금 벽돌이 빛나요/);       // 황금 → 빛나는 황금
});

test('청사초롱은 하루 목표를 처음 채운 날 1개만 (AC-44i)', () => {
  const ps = probs([[1, 1]]);
  let r = updateTower(null, ps, {}, { day: '2026-12-01', goalMet: true });
  assert.equal(r.added.lantern, true);
  assert.equal(r.tower.lantern_count, 1);
  r = updateTower(r.tower, ps, {}, { day: '2026-12-01', goalMet: true });      // 같은 날 다시
  assert.equal(r.added.lantern, false);
  assert.equal(r.tower.lantern_count, 1);
  r = updateTower(r.tower, ps, {}, { day: '2026-12-02', goalMet: false });
  assert.equal(r.added.lantern, false);
  assert.equal(hasBigScene(r.added), false);
});

test('청사초롱 날짜는 최근 60일만 남기고, 수는 계속 센다 · 28일 줄 (AC-44p)', () => {
  const ps = probs([[1, 1]]);
  let t = null;
  for (let i = 0; i < 70; i++) t = updateTower(t, ps, {}, { day: `2026-${i < 31 ? '10' : i < 61 ? '11' : '12'}-${String((i < 31 ? i : i < 61 ? i - 31 : i - 61) + 1).padStart(2, '0')}`, goalMet: true }).tower;
  assert.equal(t.lantern_count, 70);
  assert.equal(t.lantern_days.length, 60);
  const row = lanternRow(t, '2026-12-09');
  assert.equal(row.length, 28);
  assert.equal(row[27].day, '2026-12-09');
  assert.ok(row.every((d) => d.lit));
  assert.equal(lanternRow({ lantern_days: [] }, '2026-12-09')[0].lit, false);
});

test('풍경은 익힘 5개마다, 내려가도 떼지 않는다 (AC-44j)', () => {
  const ps = probs([[2, 12]]);
  const learned = (n) => Object.fromEntries(ps.slice(0, n).map((p) => [p.id, rec(4)]));
  let r = updateTower(null, ps, learned(4), { day: '2026-12-01' });
  assert.deepEqual(r.added.bells, []);
  r = updateTower(r.tower, ps, learned(5), { day: '2026-12-01' });
  assert.deepEqual(r.added.bells, [2]);
  assert.equal(r.tower.bells[2], 1);
  r = updateTower(r.tower, ps, learned(3), { day: '2026-12-02' });            // 칸이 내려감
  assert.equal(r.tower.bells[2], 1);
  assert.deepEqual(r.added.bells, []);
  r = updateTower(r.tower, ps, learned(5), { day: '2026-12-03' });            // 다시 올라와도 두 번 주지 않음
  assert.deepEqual(r.added.bells, []);
});

test('맨 위 돌은 그 단 80%(올림)에서 한 번, 문제 0개인 단은 없음 (AC-44k)', () => {
  const ps = probs([[1, 6], [3, 0]]);
  const learned = (n) => Object.fromEntries(ps.slice(0, n).map((p) => [p.id, rec(5)]));
  let r = updateTower(null, ps, learned(4), { day: '2026-12-01' });            // 6 × 0.8 = 4.8 → 5
  assert.deepEqual(r.added.caps, []);
  r = updateTower(r.tower, ps, learned(5), { day: '2026-12-01' });
  assert.deepEqual(r.added.caps, [1]);
  assert.equal(r.tower.caps[3], undefined);
  r = updateTower(r.tower, ps, {}, { day: '2026-12-02' });
  assert.equal(r.tower.caps[1], true);                                          // 내리지 않음
  assert.deepEqual(bigLines({ lantern: false, bells: [], caps: [1], done: false }, r.tower), ['기단에 갑석을 얹었어요.']);
});

test('모든 칸이 황금 벽돌 이상이면 완성 날짜를 한 번 남기고, 문제가 늘어도 지우지 않는다 (AC-44t, ADR-0008)', () => {
  const ps = probs([[1, 2]]);
  const gilt = { 'p1-0': rec(4), 'p1-1': rec(8) };                              // 황금 벽돌 + 빛나는 황금 벽돌
  assert.equal(updateTower(null, ps, { 'p1-0': rec(3), 'p1-1': rec(8) }, { day: '2027-03-28' }).added.done, false); // 거친 돌이 남으면 아님
  let r = updateTower(null, ps, { 'p1-0': rec(4) }, { day: '2027-03-28' });
  assert.equal(r.added.done, false);
  r = updateTower(r.tower, ps, gilt, { day: '2027-03-29' });
  assert.equal(r.added.done, true);
  assert.equal(r.tower.done_at, '2027-03-29');
  r = updateTower(r.tower, [...ps, { id: 'new', level: 1 }], gilt, { day: '2027-04-01' });
  assert.equal(r.tower.done_at, '2027-03-29');
  assert.equal(r.added.done, false);
  assert.equal(updateTower(null, [], {}, { day: '2027-01-01' }).added.done, false);   // 문제 0개면 완성 아님
});

test('깨진 탑 기록은 빈 탑으로 바꿔 쓴다 (flows 10장)', () => {
  assert.deepEqual(sanitizeTower('망가짐'), { lantern_count: 0, lantern_days: [], bells: {}, caps: {}, done_at: null });
  const t = sanitizeTower({ lantern_count: -3, lantern_days: ['2026-12-01', 5, 'x'], bells: { 1: 2, 2: 'a' }, caps: { 1: true, 2: 'yes' }, done_at: 7 });
  assert.deepEqual(t, { lantern_count: 1, lantern_days: ['2026-12-01'], bells: { 1: 2 }, caps: { 1: true }, done_at: null });
});
