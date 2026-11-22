// review.js 시험 — 상태 판정 · 복습 상자 · 착각 표시 (AC-21~32)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, nextBox, intervalFor, addDays, daysBetween, recordAnswer, recordView,
  remainingOptions, postpone, MAX_ATTEMPTS, STAGE,
} from '../site/js/review.js';

const D1 = '2026-11-23', D2 = '2026-11-24', D3 = '2026-11-25';
const ans = (prev, o) => recordAnswer(prev, { step: 2, mask: 0, line: 4, allOptions: true, review: true, ...o });

test('상태 5개: 확신도 × 정답 (AC-21, 필드워드와 같음)', () => {
  assert.equal(classify('sure', true), 'known');
  assert.equal(classify('sure', false), 'misconception');
  assert.equal(classify('unsure', true), 'shaky');
  assert.equal(classify('unsure', false), 'confused');
  assert.equal(classify('dontknow', true), 'unknown');
  assert.equal(classify('dontknow', false), 'unknown');
});

test('상자 이동: 앎 +1(최대 8) · 불안 그대로(최소 1) · 나머지는 4 이상이면 2칸 내림, 아니면 1', () => {
  assert.equal(nextBox(0, 'known'), 1);
  assert.equal(nextBox(8, 'known'), 8);
  assert.equal(nextBox(0, 'shaky'), 1);
  assert.equal(nextBox(5, 'shaky'), 5);
  for (const s of ['confused', 'misconception', 'unknown']) {
    assert.equal(nextBox(3, s), 1);
    assert.equal(nextBox(4, s), 2);
    assert.equal(nextBox(7, s), 5);
  }
});

test('복습 간격: 1 · 2 · 4 · 7 · 15 · 30 · 60일, 상자 8은 120일 (AC-32)', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(intervalFor), [1, 2, 4, 7, 15, 30, 60, 120]);
});

test('날짜 계산: 달 · 해 넘김', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-11-22', '2026-12-20'), 28);
});

test('하루 첫 답만 상자를 옮긴다', () => {
  const a = ans(null, { day: D1, confidence: 'sure', correct: true }).record;
  assert.equal(a.box, 1);
  const b = ans(a, { day: D1, confidence: 'sure', correct: true });
  assert.equal(b.boxMoved, false);
  assert.equal(b.record.box, 1);
  assert.equal(b.record.history.length, 2);
  const c = ans(b.record, { day: D2, confidence: 'sure', correct: true }).record;
  assert.equal(c.box, 2);
  assert.equal(c.next_review_at, addDays(D2, 2));
});

test('다음 시작 단계: 모름 → ① (AC-23), 앎 · 불안 · 헷갈림 → ② (AC-24)', () => {
  assert.equal(ans(null, { day: D1, confidence: 'dontknow', correct: false }).record.next_stage, STAGE.VIEW);
  for (const [c, ok] of [['sure', true], ['unsure', true], ['unsure', false]]) {
    assert.equal(ans(null, { day: D1, confidence: c, correct: ok }).record.next_stage, STAGE.MASK);
  }
});

test('①만 본 복습 판: 상자 그대로, 다음은 ②', () => {
  const a = ans(null, { day: D1, confidence: 'dontknow', correct: false, review: false }).record;
  const v = recordView(a, { day: D2, review: true });
  assert.equal(v.box, a.box);
  assert.equal(v.reviews, 1);
  assert.equal(v.next_stage, STAGE.MASK);
});

test('가릴 줄: 평소엔 번갈아, 착각 중이면 같은 줄 (A14 · AC-31)', () => {
  const a = ans(null, { day: D1, mask: 0, confidence: 'sure', correct: true }).record;
  assert.equal(a.mask_next, 1);
  const m = ans(null, { day: D1, mask: 1, line: 2, confidence: 'sure', correct: false }).record;
  assert.equal(m.mask_next, 1);
  assert.deepEqual(m.mis, { line: 2, streak: 0, last_day: D1 });
});

test('착각 다시 풀기: 틀린 보기를 빼면 처음 답 포함 최대 4번 안에 끝난다 (AC-27)', () => {
  const options = ['A', 'B', 'C', 'D'].map((t) => ({ text: t, correct: t === 'D' }));
  const picked = [];
  let attempts = 0;
  let left = options;
  for (;;) {
    attempts += 1;
    const pick = left[0];                // 가장 나쁜 경우: 늘 틀린 보기부터 고른다
    if (pick.correct) break;
    picked.push(pick.text);
    left = remainingOptions(options, picked);
  }
  assert.equal(attempts, 4);
  assert.ok(attempts <= MAX_ATTEMPTS);
});

test('착각 표시: 같은 날 다시 맞힌 것은 세지 않고, 서로 다른 2일 연속 맞히면 지운다 (AC-29)', () => {
  let r = ans(null, { day: D1, confidence: 'sure', correct: false }).record;     // 착각
  assert.ok(r.mis);
  r = ans(r, { day: D1, confidence: 'sure', correct: true, retry: true, allOptions: false }).record; // 그날 다시 풀어 맞힘
  assert.equal(r.mis.streak, 0);
  assert.equal(r.box, 1);                                                          // 다시 푼 답은 상자를 바꾸지 않음
  r = ans(r, { day: D2, confidence: 'sure', correct: true }).record;
  assert.equal(r.mis.streak, 1);
  const done = ans(r, { day: D3, confidence: 'sure', correct: true });
  assert.equal(done.misCleared, true);
  assert.equal(done.record.mis, undefined);
});

test('착각 표시: 보기 4개가 아니면 세지 않는다 (AC-29)', () => {
  let r = ans(null, { day: D1, confidence: 'sure', correct: false }).record;
  r = ans(r, { day: D2, confidence: 'sure', correct: true, allOptions: false }).record;
  assert.equal(r.mis.streak, 0);
});

test('착각 표시: 지우기 전에 같은 줄을 틀리면 0으로 (AC-30)', () => {
  let r = ans(null, { day: D1, confidence: 'sure', correct: false }).record;
  r = ans(r, { day: D2, confidence: 'sure', correct: true }).record;
  assert.equal(r.mis.streak, 1);
  r = ans(r, { day: D3, confidence: 'unsure', correct: false }).record;
  assert.equal(r.mis.streak, 0);
  assert.ok(r.mis);
});

test('착각 표시: 헷갈려요 + 맞음은 세지도 되돌리지도 않는다 (flows 5-2)', () => {
  let r = ans(null, { day: D1, confidence: 'sure', correct: false }).record;
  r = ans(r, { day: D2, confidence: 'sure', correct: true }).record;
  r = ans(r, { day: D3, confidence: 'unsure', correct: true }).record;
  assert.equal(r.mis.streak, 1);
});

test('나중에 다시: 다음 날 1순위, 풀면 1순위가 풀린다 (AC-28)', () => {
  const a = ans(null, { day: D1, confidence: 'sure', correct: false }).record;
  const p = postpone(a, { day: D1 });
  assert.equal(p.next_review_at, D2);
  assert.equal(p.priority_day, D2);
  const b = ans(p, { day: D2, confidence: 'sure', correct: true }).record;
  assert.equal(b.priority_day, undefined);
});
