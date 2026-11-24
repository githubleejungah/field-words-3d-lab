// 가린 코드 따라가기 도우미 시험 (AC-13b · 13c). 실제 실행(Web Worker)은 브라우저에서 확인하고,
// 여기서는 끼워 넣는 기록 호출과 비동기 판별을 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { isAsync, tracedLines, maskedLines } from '../site/js/runner.js';

test('비동기 코드를 알아본다: await · async · then (AC-13c)', () => {
  assert.equal(isAsync(['const a = 1;']), false);
  assert.equal(isAsync(['const asyncName = 1;']), false); // 이름 속 글자는 아님
  assert.equal(isAsync(['const r = await find(doc);']), true);
  assert.equal(isAsync(['Promise.resolve().then(() => 1);']), true);
});

test('가린 줄은 빼고, 문장 줄 뒤 · 블록 시작 뒤에 기록 호출을 끼운다 (AC-13b)', () => {
  const code = ['let a = 1;', 'a = 2;', 'if (a > 0) {', '  console.log(a);', '}'];
  const lines = tracedLines(code, 1, ['a', 'nope-name']);
  assert.equal(lines.length, 4);
  assert.ok(lines[0].includes('console.p(0,'));
  assert.ok(lines[1].includes('console.p(2,'));
  assert.equal(lines[3], '}');
  assert.ok(!lines.join('\n').includes('nope-name')); // 이름이 아닌 것은 넣지 않는다
});

test('끼운 코드를 실행하면 줄마다 상자 값과 출력이 남고, 원래 출력은 가린 코드와 같다', () => {
  const code = ['let desk = "새";', 'let vault = "어제";', 'let temp = vault;', 'vault = desk;', 'desk = temp;', 'console.log(vault, desk);'];
  const out = [];
  const rows = [];
  const fake = { log: (...a) => out.push(a.join(' ')), p: (line, vars) => rows.push({ line, vars: { ...vars }, out: out.slice() }) };
  vm.runInNewContext(tracedLines(code, 3, ['desk', 'vault', 'temp']).join('\n'), { console: fake });
  assert.deepEqual(rows.map((r) => r.line), [0, 1, 2, 4, 5]);       // 4번 줄(번호 3)은 실행하지 않음
  assert.deepEqual(rows[3].vars, { desk: '어제', vault: '어제', temp: '어제' });
  const plain = [];
  vm.runInNewContext(maskedLines(code, 3).join('\n'), { console: { log: (...a) => plain.push(a.join(' ')) } });
  assert.deepEqual(out, plain);
});
