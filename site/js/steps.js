// 코드 가려 보기 — ① 한 줄 실행 도우미 (화면 없음)
// 근거: docs/flows.md 3장 "위로 돌아갈 때 안내", 수용 기준 AC-17g (Q44).

// idx번 장면의 줄이 바로 앞 장면의 줄보다 위이면 { line, loop }를 돌려준다. 아니면 null.
// loop: 돌아간 줄이 for · while로 시작하면 true (되풀이로 돌아감)
export function backJump(p, idx) {
  if (!p || !Array.isArray(p.trace) || idx < 1 || idx >= p.trace.length) return null;
  const cur = p.trace[idx].line;
  const prev = p.trace[idx - 1].line;
  if (cur >= prev) return null;
  const code = (p.code[cur] || '').trim();
  return { line: cur, loop: /^(for|while)\b/.test(code) };
}

export function backJumpText(jump) {
  if (!jump) return '';
  return jump.loop ? `↑ 되풀이라 ${jump.line + 1}번 줄로 돌아왔어요.` : `↑ ${jump.line + 1}번 줄로 돌아왔어요.`;
}
