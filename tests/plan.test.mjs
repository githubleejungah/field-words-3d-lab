// plan.js 시험 — 오늘 할 일 · 시작 단계 · 선행 문제 · 배치 시험 (AC-14~16 · 23 · 31 · 33~37 · 46~47c)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { placementProblems, placementResult, prereqMet, dailyPlan, reviewItem, interleave } from '../site/js/plan.js';
import { STAGE } from '../site/js/review.js';

const DAY = '2026-11-23';
const P = (id, level, prereq = []) => ({ id, level, prereq, masks: [{ line: 1 }, { line: 2 }] });
const due = (extra = {}) => ({ box: 1, status: 'known', next_stage: 2, mask_next: 0, reviews: 1, next_review_at: DAY, history: [{ at: '2026-11-22' }], ...extra });
const steps = (q) => q.reduce((s, x) => s + x.stages.length, 0);

test('배치 시험: 등급마다 1문제, ②로 (AC-46)', () => {
  const p = [P('a1', 1), P('a2', 1), P('b1', 2), P('c1', 3), P('d1', 4)];
  assert.deepEqual(placementProblems(p).map((x) => [x.id, x.stages]), [['a1', [2]], ['b1', [2]], ['c1', [2]], ['d1', [2]]]);
});

test('배치 결과: 처음 틀린 등급부터 · 다 맞히면 심화 · 건너뛰면 입문 (AC-47 · 47a · 47b)', () => {
  assert.deepEqual(placementResult({ 1: true, 2: true, 3: false, 4: true }), { done: true, skipped: false, start_level: 3, passed_levels: [1, 2, 4] });
  assert.equal(placementResult({ 1: true, 2: true, 3: true, 4: true }).start_level, 4);
  assert.equal(placementResult({ 1: false, 2: true, 3: true, 4: true }).start_level, 1);
  assert.deepEqual(placementResult({}, { skipped: true }), { done: true, skipped: true, start_level: 1, passed_levels: [] });
});

test('처음 만난 문제는 ①+② 한 판, 맞힌 등급은 ②만 (AC-14 · 47c)', () => {
  const p = [P('a', 1), P('b', 2)];
  const plain = dailyPlan({ problems: p, records: {}, day: DAY });
  assert.deepEqual(plain.queue.map((x) => x.stages), [[1, 2], [1, 2]]);
  const placed = dailyPlan({ problems: p, records: {}, day: DAY, placement: placementResult({ 1: true, 2: false, 3: false, 4: false }) });
  assert.deepEqual(placed.queue.find((x) => x.id === 'a').stages, [2]);
  assert.deepEqual(placed.queue.find((x) => x.id === 'b').stages, [1, 2]);
});

test('선행 문제를 안 푼 문제는 새 문제로 내지 않는다 (AC-36)', () => {
  const p = [P('a', 1), P('c', 3, ['a'])];
  const q = dailyPlan({ problems: p, records: {}, day: DAY }).queue.map((x) => x.id);
  assert.deepEqual(q, ['a']);
  const after = dailyPlan({ problems: p, records: { a: { ...due(), next_review_at: '2026-11-30' } }, day: DAY }).queue.map((x) => x.id);
  assert.deepEqual(after, ['c']);
});

test('배치 시험에서 맞힌 등급의 선행 문제는 푼 것으로 본다 (AC-36a)', () => {
  const p = [P('a', 1), P('c', 3, ['a'])];
  const byId = new Map(p.map((x) => [x.id, x]));
  assert.equal(prereqMet(p[1], byId, {}, { passed_levels: [1] }), true);
  assert.equal(prereqMet(p[1], byId, {}, { passed_levels: [2] }), false);
});

test('새 문제는 시작 등급부터 낮은 등급 순, 시작 등급 아래는 그 뒤에 (AC-37)', () => {
  const p = [P('d', 4), P('a', 1), P('c', 3), P('b', 2)];
  assert.deepEqual(dailyPlan({ problems: p, records: {}, day: DAY }).queue.map((x) => x.id), ['a', 'b', 'c', 'd']);
  const placement = { start_level: 3, passed_levels: [1, 2] };
  assert.deepEqual(dailyPlan({ problems: p, records: {}, day: DAY, placement }).queue.map((x) => x.id), ['c', 'd', 'a', 'b']);
});

test('하루 목표 10단계: 복습이 없으면 새 문제로 채운다 (AC-33)', () => {
  const p = Array.from({ length: 8 }, (_, i) => P(`n${i}`, 1));
  const plan = dailyPlan({ problems: p, records: {}, day: DAY });
  assert.equal(steps(plan.queue), 10);
  assert.equal(plan.queue.length, 5);
});

test('복습이 많아도 새 문제 몫 30%(3단계 → ①+② 1개)를 남긴다 (AC-34)', () => {
  const p = [...Array.from({ length: 15 }, (_, i) => P(`r${i}`, 1)), P('n', 1)];
  const records = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`r${i}`, due()]));
  const plan = dailyPlan({ problems: p, records, day: DAY });
  assert.equal(plan.backlog, false);
  assert.equal(plan.new_steps, 2);
  assert.equal(plan.review_steps, 8);
  assert.equal(steps(plan.queue), 10);
});

test('밀린 복습이 목표의 2배(20단계)를 넘으면 새 문제 1개 (AC-35)', () => {
  const mk = (n) => {
    const p = [...Array.from({ length: n }, (_, i) => P(`r${i}`, 1)), P('n1', 1), P('n2', 1)];
    const records = Object.fromEntries(Array.from({ length: n }, (_, i) => [`r${i}`, due()]));
    return { p, records };
  };
  const at20 = mk(20);
  assert.equal(dailyPlan({ problems: at20.p, records: at20.records, day: DAY }).backlog, false);
  const at21 = mk(21);
  const plan = dailyPlan({ problems: at21.p, records: at21.records, day: DAY });
  assert.equal(plan.backlog, true);
  assert.equal(plan.queue.filter((x) => x.kind === 'new').length, 1);
  const later = dailyPlan({ problems: at21.p, records: at21.records, day: DAY, today: { steps_done: 2, new_steps_done: 2, seen: ['n1'] } });
  assert.equal(later.queue.filter((x) => x.kind === 'new').length, 0);
});

test('복습 순서: 나중에 다시 → 착각 → 헷갈림 → 모름 → 불안 → 앎 (AC-28)', () => {
  const ids = ['k', 's', 'u', 'c', 'm', 'later'];
  const p = ids.map((id) => P(id, 1));
  const records = {
    k: due({ status: 'known' }), s: due({ status: 'shaky' }), u: due({ status: 'unknown', next_stage: 1 }),
    c: due({ status: 'confused' }), m: due({ status: 'shaky', mis: { line: 2, streak: 1, last_day: '2026-11-22' } }),
    later: due({ status: 'known', priority_day: DAY }),
  };
  const q = dailyPlan({ problems: p, records, day: DAY }).queue.map((x) => x.id);
  assert.deepEqual(q, ['later', 'm', 'c', 'u', 's', 'k']);
});

test('복습 판 단계: 첫 복습 ③, 첫 답이 모름이면 ①, 착각이면 같은 줄 ② (AC-15 · 23 · 31)', () => {
  const p = P('x', 1);
  assert.deepEqual(reviewItem(p, due({ reviews: 0, mask_next: 1 })), { stages: [STAGE.INTERPRET], mask: 1 });
  assert.deepEqual(reviewItem(p, due({ reviews: 0, status: 'unknown', next_stage: 1 })), { stages: [STAGE.VIEW], mask: 0 });
  assert.deepEqual(reviewItem(p, due({ reviews: 0, mis: { line: 2, streak: 0, last_day: '2026-11-22' } })), { stages: [STAGE.MASK], mask: 1 });
  assert.deepEqual(reviewItem(p, due({ reviews: 2, next_stage: 2, mask_next: 1 })), { stages: [STAGE.MASK], mask: 1 });
});

test('오늘 이미 본 문제 · 한 단계 수 · 더 하기를 반영한다', () => {
  const p = Array.from({ length: 8 }, (_, i) => P(`n${i}`, 1));
  const plan = dailyPlan({ problems: p, records: {}, day: DAY, today: { steps_done: 8, new_steps_done: 8, seen: ['n0', 'n1', 'n2', 'n3'] } });
  assert.equal(steps(plan.queue), 2);
  assert.ok(!plan.queue.some((x) => ['n0', 'n1', 'n2', 'n3'].includes(x.id)));
  const more = dailyPlan({ problems: p, records: {}, day: DAY, today: { steps_done: 10, new_steps_done: 10, seen: ['n0', 'n1', 'n2', 'n3', 'n4'] }, extra: 4 });
  assert.equal(steps(more.queue), 4);
});

test('복습 2개마다 새 문제 1개로 섞는다', () => {
  assert.deepEqual(interleave(['r1', 'r2', 'r3'], ['n1', 'n2']), ['r1', 'r2', 'n1', 'r3', 'n2']);
});

test('실제 문제 8개: 첫날 처음엔 값 넣기만(나머지는 선행 문제 때문에 뒤로)', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../site/data/problems.json', import.meta.url), 'utf8'));
  const plan = dailyPlan({ problems: data.problems, records: {}, day: DAY });
  assert.deepEqual(plan.queue.map((x) => [x.id, x.stages]), [['assign-basic', [1, 2]]]);
});
