// 실전 읽기 확인 시험 (AC-77~85, docs/flows.md 12장 · data-model 7장)
// 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as RD from '../site/js/reading.js';
import { checkReadings } from '../tools/check_problems.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = JSON.parse(fs.readFileSync(path.join(root, 'site/data/reading.json'), 'utf8'));
const clone = () => structuredClone(DATA);
const rules = (d) => checkReadings(d).errors.map((e) => e.rule);
const PLACED = { done: true, skipped: false, start_level: 2, passed_levels: [1] };
const run = (reading_id, day) => ({ reading_id, day, answers: { what: 'a', io: 'b', key: 'c' }, marks: [1, 1, 1], score: 1, repeat: false });

test('할 때: 배치 시험 전에는 아니고, 마친 뒤 기록 0회면 권한다 (AC-77)', () => {
  assert.equal(RD.readingDue(null, null, '2026-11-23'), false);
  assert.equal(RD.readingDue(null, PLACED, '2026-11-23'), true);
  assert.equal(RD.readingDue(null, { done: true, skipped: true, start_level: 1, passed_levels: [] }, '2026-11-23'), true);
});

test('할 때: 마지막 회차 뒤 27일은 아니고 28일이면 다시 (AC-78)', () => {
  const rec = { runs: [run('session-id', '2026-11-01')] };
  assert.equal(RD.readingDue(rec, PLACED, '2026-11-28'), false);
  assert.equal(RD.readingDue(rec, PLACED, '2026-11-29'), true);
});

test('읽을 코드: 안 읽은 것을 데이터 순서대로, 다 읽었으면 가장 오래전 것을 다시 읽음으로', () => {
  const list = DATA.readings;
  assert.equal(RD.pickReading(list, null).reading.id, 'session-id');
  const one = { runs: [run('session-id', '2026-11-01')] };
  assert.deepEqual([RD.pickReading(list, one).reading.id, RD.pickReading(list, one).repeat], ['http-helpers', false]);
  const both = { runs: [run('session-id', '2026-11-01'), run('http-helpers', '2026-11-29'), run('session-id', '2026-12-27')] };
  assert.deepEqual([RD.pickReading(list, both).reading.id, RD.pickReading(list, both).repeat], ['http-helpers', true]);
  assert.equal(RD.pickReading([], null), null);
});

test('점수 = (맞힘 1 + 부분 0.5) ÷ 점 수, 소수 둘째 자리 (AC-83)', () => {
  assert.equal(RD.readingScore([RD.MARK.hit, RD.MARK.partial, RD.MARK.miss, RD.MARK.hit]), 0.63); // 2.5 ÷ 4 = 0.625
  assert.equal(RD.readingScore([1, 1, 1]), 1);
  assert.equal(RD.readingScore([0, 0, 0]), 0);
  assert.equal(RD.readingScore([]), 0);
});

test('회차를 더해도 지난 기록은 그대로, 점수는 그때 값으로 남는다 (AC-83)', () => {
  const before = { runs: [run('session-id', '2026-11-01')] };
  const after = RD.addRun(before, { reading_id: 'http-helpers', day: '2026-11-29', answers: { what: 'x', io: 'y', key: 'z' }, marks: [1, 0.5, 0, 0.5] });
  assert.equal(before.runs.length, 1);
  assert.equal(after.runs.length, 2);
  assert.equal(after.runs[1].score, 0.5);
  assert.deepEqual(RD.readingHistory(after).map((x) => x.percent), [100, 50]);
});

test('복습 상자 · 하루 단계 · 등급 코드는 실전 읽기 기록을 읽지 않는다 (AC-84)', () => {
  for (const f of ['review.js', 'plan.js', 'grade.js']) {
    const src = fs.readFileSync(path.join(root, 'site/js', f), 'utf8');
    assert.equal(/reading/i.test(src), false, `${f}에 reading이 있음`);
  }
});

test('실제 실전 읽기 코드 2개는 사이트 모양 검사 · 검사 도구를 모두 통과한다', () => {
  assert.ok(DATA.readings.every(RD.validReading));
  assert.deepEqual(checkReadings(DATA).errors, []);
});

test('코드가 19줄이거나 31줄이면 걸린다 (AC-79)', () => {
  const d = clone();
  d.readings[0].code = d.readings[0].code.slice(0, 19);
  d.readings[1].code = [...d.readings[1].code, ...Array(5).fill('// 더함')];
  assert.equal(rules(d).filter((r) => r === 'reading-lines').length, 2);
  assert.equal(RD.validReading(d.readings[0]), false);
});

test('꼭 짚을 점이 2개 · 모범 답 빈칸 · 중요한 줄 범위 밖 · 같은 id는 걸린다 (AC-81 · 82)', () => {
  const d = clone();
  d.readings[0].points = d.readings[0].points.slice(0, 2);
  d.readings[0].model.io = ' ';
  d.readings[1].model.key.line = 40;
  d.readings[1].id = d.readings[0].id;
  const r = rules(d);
  for (const rule of ['reading-points', 'reading-model', 'reading-key-line', 'reading-id']) assert.ok(r.includes(rule), rule);
});

test('비밀 값 모양이 있으면 걸린다 (AC-85)', () => {
  const samples = [
    'const key = "sk-abcdefghijklmnopqrstu"',
    'const password = "hunter22"',
    "apiKey: 'Zx9_long_value'",
    '// 문의: someone@example.com',
    '전화 010-1234-5678',
    'const url = "postgres://admin:pw@db/app"',
    'const host = "192.168.0.12"',
    '-----BEGIN RSA PRIVATE KEY-----',
  ];
  for (const s of samples) {
    const d = clone();
    d.readings[0].code[0] = s;
    assert.ok(rules(d).includes('reading-secret'), s);
  }
});

test('비밀이 아닌 흔한 글은 걸리지 않는다 (패키지 버전 · 저장소 키 이름)', () => {
  const d = clone();
  d.readings[0].code[0] = "import x from 'pinia@2.1.0' // 'retail-chatbot.session-id'";
  assert.equal(rules(d).includes('reading-secret'), false);
});
