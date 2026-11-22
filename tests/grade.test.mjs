// grade.js 시험 — 승급 · 이정표 · 주간 착각 비율 (AC-38~44 · 75 · 76)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelProgress, updateGrade, logAnswer, weeklyMisRatio, successMet, LEVEL_NAMES } from '../site/js/grade.js';

const probs = (spec) => spec.flatMap(([level, n]) => Array.from({ length: n }, (_, i) => ({ id: `p${level}-${i}`, level })));
const rec = (box, extra = {}) => ({ box, history: [{}], ...extra });

test('등급 이름 4개는 필드워드와 같은 글자 (AC-38)', () => {
  assert.deepEqual(Object.values(LEVEL_NAMES), ['입문', '기본', '실무', '심화']);
});

test('승급에 필요한 수는 80%를 올림: 2문제 → 2, 5문제 → 4, 10문제 → 8 (AC-39)', () => {
  for (const [n, need] of [[2, 2], [5, 4], [10, 8]]) {
    assert.equal(levelProgress(probs([[1, n]]), {}, 1).need, need);
  }
});

test('지금 등급 문제의 80% 이상이 상자 4 이상이면 승급한다 (AC-39)', () => {
  const p = probs([[1, 2], [2, 2]]);
  const one = updateGrade(null, p, { 'p1-0': rec(4) });
  assert.equal(one.grade.level, 1);
  assert.equal(one.banner, null);
  const two = updateGrade(null, p, { 'p1-0': rec(4), 'p1-1': rec(5) });
  assert.equal(two.grade.level, 2);
  assert.deepEqual(two.banner, { type: 'promote', level: 2, name: '기본' });
});

test('착각이 남아 있어도 승급하고, 배너에 남은 착각 수를 쓴다 (AC-41 · 42)', () => {
  const p = probs([[1, 2], [2, 2]]);
  const r = { 'p1-0': rec(4), 'p1-1': rec(6, { mis: { line: 1, streak: 0, last_day: '2026-11-23' } }), 'p2-0': rec(1, { mis: { line: 2, streak: 1, last_day: '2026-11-23' } }) };
  const g = updateGrade(null, p, r);
  assert.equal(g.grade.level, 2);
  assert.equal(g.banner.misconceptions, 2);
});

test('상자가 내려가도 등급은 내려가지 않는다 (AC-40)', () => {
  const p = probs([[1, 2], [2, 2]]);
  const g = updateGrade({ level: 2, milestones_shown: 0 }, p, { 'p1-0': rec(1), 'p1-1': rec(1) });
  assert.equal(g.grade.level, 2);
  assert.equal(g.banner, null);
});

test('문제가 0개인 등급으로는 저절로 오르지 않는다', () => {
  const p = probs([[1, 2]]);
  const g = updateGrade(null, p, { 'p1-0': rec(4), 'p1-1': rec(4) });
  assert.equal(g.grade.level, 2);           // 1 → 2는 오른다
  const again = updateGrade(g.grade, p, { 'p1-0': rec(4), 'p1-1': rec(4) });
  assert.equal(again.grade.level, 2);       // 2에는 문제가 없어 더 오르지 않는다
});

test('한 등급 안에서 익힌 문제 5개마다 이정표 배너 1개, 두 번 보여 주지 않는다 (AC-43 · 44)', () => {
  const p = probs([[1, 10]]);
  const five = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`p1-${i}`, rec(4)]));
  const g = updateGrade(null, p, five);
  assert.deepEqual(g.banner, { type: 'milestone', level: 1, name: '입문', learned: 5 });
  assert.equal(updateGrade(g.grade, p, five).banner, null);
});

test('주간 착각 비율: 7일씩 끊고, 착각 다시 풀기 답은 세지 않는다 (AC-75)', () => {
  let log = {};
  log = logAnswer(log, { day: '2026-11-23', status: 'misconception' });
  log = logAnswer(log, { day: '2026-11-23', status: 'known', retry: true });
  log = logAnswer(log, { day: '2026-11-24', status: 'known' });
  log = logAnswer(log, { day: '2026-11-30', status: 'known' });
  const w = weeklyMisRatio(log, '2026-11-23', '2026-11-30');
  assert.equal(w.length, 2);
  assert.deepEqual(w[0], { week: 1, answers: 2, misconceptions: 1, ratio: 0.5 });
  assert.deepEqual(w[1], { week: 2, answers: 1, misconceptions: 0, ratio: 0 });
});

test('성공 지표: 4주차 비율이 1주차보다 낮으면 참, 답이 없으면 아직 모름 (AC-76)', () => {
  const mk = (r1, r4) => [{ ratio: r1 }, { ratio: 0 }, { ratio: 0 }, { ratio: r4 }];
  assert.equal(successMet(mk(0.4, 0.1)), true);
  assert.equal(successMet(mk(0.1, 0.4)), false);
  assert.equal(successMet(mk(0.4, null)), null);
  assert.equal(successMet([{ ratio: 0.4 }]), null);
});
