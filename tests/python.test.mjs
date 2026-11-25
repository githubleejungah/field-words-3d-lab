// python.js 시험 — 파이썬 연습 규칙 (AC-97 · 98 · 99 · 103)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as PY from '../site/js/python.js';
import { STAGE, recordAnswer, recordView } from '../site/js/review.js';
import { allRecords, read, write } from '../site/js/store.js';

const pr = (id, level) => ({ id, level, masks: [{ line: 0 }, { line: 1 }] });
const list = [pr('py-c', 3), pr('py-a', 1), pr('py-b', 2), pr('py-d', 4)];
const DAY = '2026-11-26';

test('처음에는 안 푼 연습을 등급 순으로, ①부터 낸다', () => {
  const it = PY.pickNext(list, {}, DAY);
  assert.deepEqual(it, { id: 'py-a', kind: 'new', stages: [STAGE.VIEW, STAGE.MASK], mask: 0 });
});

test('오늘 복습할 연습이 안 푼 연습보다 먼저 (AC-98)', () => {
  let rec = recordView(null, { day: '2026-11-25' });
  rec = recordAnswer(rec, { day: '2026-11-25', step: 2, mask: 0, line: 0, confidence: 'sure', correct: true }).record;
  const it = PY.pickNext(list, { 'py-c': rec }, rec.next_review_at);
  assert.equal(it.id, 'py-c');
  assert.equal(it.kind, 'review');
  // 복습 날짜 전이면 안 푼 연습
  assert.equal(PY.pickNext(list, { 'py-c': rec }, '2026-11-25').id, 'py-a');
});

test('다 풀고 복습 날짜 전이면 null, 다시 풀어 보기는 가장 가까운 연습 ② 한 단계', () => {
  const recs = {};
  for (const [i, p] of list.entries()) {
    let r = recordView(null, { day: DAY });
    r = recordAnswer(r, { day: DAY, step: 2, mask: 0, line: 0, confidence: i === 0 ? 'unsure' : 'sure', correct: true }).record;
    recs[p.id] = r;
  }
  assert.equal(PY.pickNext(list, recs, DAY), null);
  const again = PY.againItem(list, recs, DAY);
  assert.equal(again.kind, 'again');
  assert.deepEqual(again.stages, [STAGE.MASK]);
  assert.ok(PY.nextDueDays(list, recs, DAY) >= 1);
});

test('돌 4칸 줄은 등급 순, 석탑과 같은 돌 모양 (AC-99)', () => {
  const s = PY.stones(list, {});
  assert.deepEqual(s.map((x) => x.id), ['py-a', 'py-b', 'py-c', 'py-d']);
  assert.ok(s.every((x) => x.shape === 'empty'));
});

test('동의는 on · off 1칸만 인정한다 (AC-103)', () => {
  assert.equal(PY.consentOf('on'), 'on');
  assert.equal(PY.consentOf('off'), 'off');
  assert.equal(PY.consentOf(null), null);
  assert.equal(PY.consentOf('yes'), null);
  assert.equal(PY.recKey('py-a'), 'py:py-a');
});

test('파이썬 기록 키는 자바스크립트 기록 모음에 섞이지 않는다 (AC-97)', () => {
  // allRecords는 problem:<id> 키만 읽는다. py:<id>는 앞글자가 달라 읽히지 않는다.
  write(PY.recKey('py-a'), { box: 3 });
  assert.deepEqual(read(PY.recKey('py-a'), null), { box: 3 });  // 파이썬 키에는 저장된다
  assert.deepEqual(allRecords([{ id: 'py-a' }]), {});            // 자바스크립트 기록 모음에는 없다
});

test('파이썬 연습 후보는 이 PC의 파이썬으로 실제 실행해 오류 0건 (AC-114)', async () => {
  const fs = await import('node:fs');
  const { checkProblems } = await import('../tools/check_problems.mjs');
  const f = new URL('../docs/candidates/python-candidates.json', import.meta.url);
  const pf = new URL('../site/data/python.json', import.meta.url);
  const list = [...(fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')).problems : []), ...(fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).problems : [])];
  if (!list.length) return;
  const words = JSON.parse(fs.readFileSync(new URL('../site/data/words.json', import.meta.url), 'utf8'));
  const { errors, runs } = await checkProblems({ schema_version: '1.0', problems: list }, words, null, { python: true });
  assert.deepEqual(errors, []);
  assert.equal(runs.length, list.length * 3); // 원래 1번 + 가린 줄 2번
});

test('자바스크립트 문제를 파이썬 검사에 넣으면 lang 오류 (AC-95)', async () => {
  const { checkProblems } = await import('../tools/check_problems.mjs');
  const { errors } = await checkProblems({ schema_version: '1.0', problems: [{ id: 'x', lang: 'javascript' }] }, { words: {} }, null, { python: true });
  assert.ok(errors.some((e) => e.rule === 'lang'));
});
