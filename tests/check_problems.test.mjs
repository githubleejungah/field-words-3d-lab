// 검사 도구 시험: 실제 문제는 통과하고, 일부러 깨뜨린 문제는 정해진 규칙으로 걸려야 한다.
// 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProblems, runCode, formatArgs } from '../tools/check_problems.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const PROBLEMS = load('site/data/problems.json');
const WORDS = load('site/data/words.json');
// 필드워드 사전 대신 쓰는 작은 사본(시험이 다른 저장소에 기대지 않게). 값은 필드워드 glossary.json에서 확인함.
const GLOSSARY = new Map([['backup', 1], ['cache', 2]]);

const clone = () => structuredClone(PROBLEMS);
const cache = (d) => d.problems.find((p) => p.id === 'cache-basic');
const assign = (d) => d.problems.find((p) => p.id === 'assign-basic');
const rules = (d, words = WORDS) => checkProblems(d, words, GLOSSARY).errors.map((e) => e.rule);

test('실제 문제 2개는 오류 0건', () => {
  assert.deepEqual(checkProblems(PROBLEMS, WORDS, GLOSSARY).errors, []);
});

test('출력 글자 규칙: 글자는 그대로, 그 밖은 JSON, 띄어쓰기 하나', () => {
  assert.equal(formatArgs(['a', 1, [2], { b: 3 }]), 'a 1 [2] {"b":3}');
});

test('끝나지 않는 코드는 1초 상한으로 멈춘다', () => {
  const r = runCode(['let i = 0;', 'while (true) { i++; }', 'console.log(i);']);
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'timeout');
});

test('지워도 출력이 같은 줄을 가리면 걸린다 (AC-11)', () => {
  const d = clone();
  const p = cache(d);
  p.code.splice(7, 0, 'const unused = 1;');            // 8번째 줄에 아무 일도 안 하는 줄
  for (const k of ['explain', 'ko']) p[k].splice(7, 0, '쓰지 않는 줄');
  p.labels[3].from = 8; p.labels[3].to = 9;
  for (const s of p.trace) if (s.line >= 7) s.line += 1;
  p.play.slots[0].line = 9;
  p.masks[1].line = 7; p.masks[1].output = p.outputs.original;
  assert.ok(rules(d).includes('mask-same-output'));
});

test('지우면 문법 오류가 나는 줄을 가리면 걸린다 (AC-11)', () => {
  const d = clone();
  cache(d).masks[1].line = 6;                            // 함수의 닫는 괄호 }
  assert.ok(rules(d).includes('mask-syntax'));
});

test('저장 출력이 실제와 다르면 걸린다', () => {
  const d = clone();
  cache(d).outputs.original = ['3000원 (서버)', '3000원 (서버)'];
  assert.ok(rules(d).includes('output-original'));
});

test('가린 줄의 저장 출력이 실제와 다르면 걸린다', () => {
  const d = clone();
  assign(d).masks[0].output = ['오늘 보고서'];
  assert.ok(rules(d).includes('mask-output'));
});

test('정답이 2개면 걸린다 (AC-12)', () => {
  const d = clone();
  assign(d).masks[0].predict.options[0].correct = true;
  assert.ok(rules(d).includes('options-correct'));
});

test('틀린 보기에 착각 풀이가 없으면 걸린다 (AC-13)', () => {
  const d = clone();
  delete assign(d).masks[0].interpret.options[1].why;
  assert.ok(rules(d).includes('option-why'));
});

test('보기가 3개면 걸린다 (AC-12)', () => {
  const d = clone();
  assign(d).masks[1].predict.options.pop();
  assert.ok(rules(d).includes('options-count'));
});

test('가릴 줄 후보가 1개면 걸린다 (AC-10)', () => {
  const d = clone();
  assign(d).masks.pop();
  assert.ok(rules(d).includes('mask-count'));
});

test('등급이 max(용어 등급, 코드 난이도)와 다르면 걸린다 (AC-09)', () => {
  const d = clone();
  cache(d).level = 2;
  assert.ok(rules(d).includes('level'));
});

test('필드워드에 없는 용어를 잇거나 용어가 없으면 걸린다 (AC-07)', () => {
  const d = clone();
  cache(d).terms = ['no-such-term'];
  assign(d).terms = [];
  const r = rules(d);
  assert.ok(r.includes('term-unknown'));
  assert.ok(r.includes('terms-empty'));
});

test('선행 문제가 고리를 이루면 걸린다', () => {
  const d = clone();
  assign(d).prereq = ['cache-basic'];
  assert.ok(rules(d).includes('prereq-cycle'));
});

test('코드가 11줄이면 걸린다 (AC-08)', () => {
  const d = clone();
  const p = cache(d);
  p.code.push('console.log(1);', 'console.log(2);');
  assert.ok(rules(d).includes('code-lines'));
});

test('trace 마지막 장면이 저장 출력과 다르면 걸린다', () => {
  const d = clone();
  cache(d).trace.at(-1).out = ['3000원 (서버)'];
  assert.ok(rules(d).includes('trace-output'));
});

test('words.json에 없는 낱말은 걸린다', () => {
  const d = clone();
  assign(d).words.push('while');
  assert.ok(rules(d).includes('word-unknown'));
});

test('바꿔 보기 값이 끝나지 않는 코드를 만들면 걸린다', () => {
  const d = clone();
  const p = assign(d);
  p.code[1] = 'backup = "오늘 보고서"; while (LOOP) {}';
  p.play = { slots: [{ name: '반복', line: 1, token: 'LOOP', values: ['true'] }] };
  const r = rules(d);
  assert.ok(r.includes('play-timeout'));
});

test('바꿔 보기 값에 코드 조각을 넣으면 걸린다', () => {
  const d = clone();
  cache(d).play.slots[0].values.push('3); alert(1');
  assert.ok(rules(d).includes('play-value'));
});
