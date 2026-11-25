// steps.js 시험 — 위로 돌아갈 때 안내 (AC-17g, Q44)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backJump, backJumpText } from '../site/js/steps.js';

const p = {
  code: ['let a = 0;', 'for (const x of xs) {', '  a++;', '}', 'console.log(a);', 'function f() {', '  return 1;', '}', 'f();'],
  trace: [{ line: 0 }, { line: 1 }, { line: 2 }, { line: 1 }, { line: 4 }, { line: 8 }, { line: 6 }],
};

test('앞 장면보다 위 줄이면 돌아간 줄을 알려 준다 (AC-17g)', () => {
  assert.equal(backJump(p, 1), null);                                  // 아래로 감
  assert.deepEqual(backJump(p, 3), { line: 1, loop: true });           // for 줄로 돌아감
  assert.equal(backJumpText(backJump(p, 3)), '↑ 되풀이라 2번 줄로 돌아왔어요.');
  assert.deepEqual(backJump(p, 6), { line: 6, loop: false });          // 함수 안으로 위에 있는 줄
  assert.equal(backJumpText(backJump(p, 6)), '↑ 7번 줄로 돌아왔어요.');
});

test('첫 장면 · 범위 밖 · 같은 줄은 안내하지 않는다', () => {
  assert.equal(backJump(p, 0), null);
  assert.equal(backJump(p, 99), null);
  assert.equal(backJump({ code: ['a;'], trace: [{ line: 0 }, { line: 0 }] }, 1), null);
  assert.equal(backJumpText(null), '');
});

test('실제 문제: 멈추기 · 건너뛰기는 4번 · 7번 줄 다음에 3번 줄로 돌아간다', async () => {
  const fs = await import('node:fs');
  const all = [...JSON.parse(fs.readFileSync(new URL('../site/data/problems.json', import.meta.url), 'utf8')).problems,
    ...JSON.parse(fs.readFileSync(new URL('../docs/candidates/problems-candidates.json', import.meta.url), 'utf8')).problems];
  const br = all.find((x) => x.id === 'break-basic');
  if (!br) return; // 후보가 옮겨지거나 빠지면 건너뛴다
  const jumps = br.trace.map((_, i) => backJump(br, i)).filter(Boolean);
  assert.ok(jumps.length >= 2);
  assert.ok(jumps.every((j) => j.line === 2 && j.loop));
});
