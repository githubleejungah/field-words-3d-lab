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
const GLOSSARY = new Map([['backup', 1], ['saas', 1], ['mfa', 1], ['ax', 1], ['api', 1], ['batch-processing', 2], ['cache', 2], ['json', 2], ['retry', 2], ['polling', 3],
  // 더할 16개(data-model 2-5)의 용어. 등급은 필드워드 glossary.json에서 확인함(2026-11-24)
  ['validation', 2], ['environment-variable', 2], ['log', 2], ['token', 2], ['rate-limit', 3], ['feature-flag', 3], ['rollback', 3], ['de-identification', 3],
  ['orchestration', 4], ['observability', 3], ['rag', 3], ['webhook', 3],
  // 2026-11-25 기본 · 실무 묶음과 다음 심화 묶음의 용어. 등급은 필드워드 glossary.json에서 확인함
  ['authentication', 2], ['deployment', 2], ['incident', 2], ['unit-test', 2], ['staging', 3], ['least-privilege', 3], ['edge-case', 3], ['sla', 3],
  ['circuit-breaker', 3], ['fallback', 3], ['multi-tenancy', 4], ['technical-debt', 3]]);

const clone = () => structuredClone(PROBLEMS);
const cache = (d) => d.problems.find((p) => p.id === 'cache-basic');
const assign = (d) => d.problems.find((p) => p.id === 'assign-basic');
const rules = async (d, words = WORDS) => (await checkProblems(d, words, GLOSSARY)).errors.map((e) => e.rule);

test('실제 문제는 모두 오류 0건', async () => {
  assert.deepEqual((await checkProblems(PROBLEMS, WORDS, GLOSSARY)).errors, []);
});

test('출력 글자 규칙: 글자는 그대로, 그 밖은 JSON, 띄어쓰기 하나', async () => {
  assert.equal(formatArgs(['a', 1, [2], { b: 3 }]), 'a 1 [2] {"b":3}');
});

test('끝나지 않는 코드는 1초 상한으로 멈춘다', async () => {
  const r = await runCode(['let i = 0;', 'while (true) { i++; }', 'console.log(i);']);
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'timeout');
});

test('비동기 코드 안의 오류도 실행 중 오류로 잡는다 (브라우저와 같게)', async () => {
  const r = await runCode(['async function f() {', '  await 1;', '  missing();', '}', 'f();', 'console.log("먼저");']);
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'runtime');
  const ok = await runCode(['async function f() {', '  await 1;', '  console.log("나중");', '}', 'f();', 'console.log("먼저");']);
  assert.deepEqual(ok.out, ['먼저', '나중']);
});

test('예제에 타이머(setTimeout)를 쓰면 실행 중 오류로 걸린다 (data-model 2-2)', async () => {
  const d = clone();
  assign(d).code[0] = 'setTimeout(() => console.log(1), 0);';
  assert.ok((await rules(d)).includes('run-original'));
});

test('지워도 출력이 같은 줄을 가리면 걸린다 (AC-11)', async () => {
  const d = clone();
  const p = cache(d);
  p.code.splice(7, 0, 'const unused = 1;');            // 8번째 줄에 아무 일도 안 하는 줄
  for (const k of ['explain', 'ko']) p[k].splice(7, 0, '쓰지 않는 줄');
  p.labels[3].from = 8; p.labels[3].to = 9;
  for (const s of p.trace) if (s.line >= 7) s.line += 1;
  p.play.slots[0].line = 9;
  p.masks[1].line = 7; p.masks[1].output = p.outputs.original;
  assert.ok((await rules(d)).includes('mask-same-output'));
});

test('지우면 문법 오류가 나는 줄을 가리면 걸린다 (AC-11)', async () => {
  const d = clone();
  cache(d).masks[1].line = 6;                            // 함수의 닫는 괄호 }
  assert.ok((await rules(d)).includes('mask-syntax'));
});

test('저장 출력이 실제와 다르면 걸린다', async () => {
  const d = clone();
  cache(d).outputs.original = ['3000원 (서버)', '3000원 (서버)'];
  assert.ok((await rules(d)).includes('output-original'));
});

test('가린 줄의 저장 출력이 실제와 다르면 걸린다', async () => {
  const d = clone();
  assign(d).masks[0].output = ['오늘 보고서'];
  assert.ok((await rules(d)).includes('mask-output'));
});

test('정답이 2개면 걸린다 (AC-12)', async () => {
  const d = clone();
  assign(d).masks[0].predict.options[0].correct = true;
  assert.ok((await rules(d)).includes('options-correct'));
});

test('틀린 보기에 착각 풀이가 없으면 걸린다 (AC-13)', async () => {
  const d = clone();
  delete assign(d).masks[0].interpret.options[1].why;
  assert.ok((await rules(d)).includes('option-why'));
});

test('보기가 3개면 걸린다 (AC-12)', async () => {
  const d = clone();
  assign(d).masks[1].predict.options.pop();
  assert.ok((await rules(d)).includes('options-count'));
});

test('가릴 줄 후보가 1개면 걸린다 (AC-10)', async () => {
  const d = clone();
  assign(d).masks.pop();
  assert.ok((await rules(d)).includes('mask-count'));
});

test('등급이 max(용어 등급, 코드 난이도)와 다르면 걸린다 (AC-09)', async () => {
  const d = clone();
  cache(d).level = 2;
  assert.ok((await rules(d)).includes('level'));
});

test('필드워드에 없는 용어를 잇거나 용어가 없으면 걸린다 (AC-07)', async () => {
  const d = clone();
  cache(d).terms = ['no-such-term'];
  assign(d).terms = [];
  const r = (await rules(d));
  assert.ok(r.includes('term-unknown'));
  assert.ok(r.includes('terms-empty'));
});

test('선행 문제가 고리를 이루면 걸린다', async () => {
  const d = clone();
  assign(d).prereq = ['cache-basic'];
  assert.ok((await rules(d)).includes('prereq-cycle'));
});

test('코드가 11줄이면 걸린다 (AC-08)', async () => {
  const d = clone();
  const p = cache(d);
  p.code.push('console.log(1);', 'console.log(2);');
  assert.ok((await rules(d)).includes('code-lines'));
});

test('trace 마지막 장면이 저장 출력과 다르면 걸린다', async () => {
  const d = clone();
  cache(d).trace.at(-1).out = ['3000원 (서버)'];
  assert.ok((await rules(d)).includes('trace-output'));
});

test('이 코드에서 이 용어는(in_code) 줄 번호가 범위 밖이거나 칸이 없으면 걸린다', async () => {
  const d = clone();
  cache(d).in_code[0].lines = [20];
  delete assign(d).in_code;
  const r = await rules(d);
  assert.ok(r.includes('in-code-line'));
  assert.ok(r.includes('in-code'));
});

test('② 정답 보기의 출력 줄이 실제 실행 결과와 다르면 걸린다', async () => {
  const d = clone();
  const opt = cache(d).masks[0].predict.options.find((o) => o.correct);
  opt.out = ['3000원 (서버)', '3000원 (캐시)'];
  assert.ok((await rules(d)).includes('predict-out'));
});

test('③ 정답 보기의 코드 조각이 가린 줄에 없거나, 코드 조각이 빠지면 걸린다', async () => {
  const d = clone();
  cache(d).masks[0].interpret.options.find((o) => o.correct).code = 'cache = price';
  delete assign(d).masks[0].interpret.options[1].code;
  const r = await rules(d);
  assert.ok(r.includes('interpret-code-line'));
  assert.ok(r.includes('interpret-code'));
});

test('조각 풀이가 줄에 차례대로 없거나 이름 풀이가 코드에 없으면 걸린다', async () => {
  const d = clone();
  cache(d).pieces[4] = [['price', '가격'], ['cache[id]', '책상 칸']]; // 순서가 거꾸로
  assign(d).names.nothing = '없는 이름';
  const r = await rules(d);
  assert.ok(r.includes('piece-order'));
  assert.ok(r.includes('name-unknown'));
});

test('words.json에 없는 낱말은 걸린다', async () => {
  const d = clone();
  assign(d).words.push('switch') // 사전에 없는 낱말(while은 2026-11-24 기본 묶음에서 사전에 더함);
  assert.ok((await rules(d)).includes('word-unknown'));
});

test('바꿔 보기 값이 끝나지 않는 코드를 만들면 걸린다', async () => {
  const d = clone();
  const p = assign(d);
  p.code[1] = 'backup = "오늘 보고서"; while (LOOP) {}';
  p.play = { slots: [{ name: '반복', line: 1, token: 'LOOP', values: ['true'] }] };
  const r = (await rules(d));
  assert.ok(r.includes('play-timeout'));
});

test('바꿔 보기 값에 코드 조각을 넣으면 걸린다', async () => {
  const d = clone();
  cache(d).play.slots[0].values.push('3); alert(1');
  assert.ok((await rules(d)).includes('play-value'));
});
