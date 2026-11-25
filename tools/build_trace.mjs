// 한 줄 실행 장면(trace) 만들기: 상자 값 · 출력은 실제 실행으로 채우고, 설명(note)만 사람이 쓴다.
// 쓰는 법(문제 초안 스크립트 안에서):
//   import { buildTrace } from './build_trace.mjs';
//   const { trace, original } = buildTrace(code, ['상자', '이름'], { 0: '첫 줄 설명', '2#1': '2번(0부터) 줄의 두 번째 실행 설명' }, extras);
// - notes 키: "줄"(0부터) 또는 "줄#몇번째"(같은 줄이 여러 번 실행될 때, 0부터).
// - extras: [{ after: [줄, 몇번째], line, note }] — 조건이 거짓이거나 continue · break로 실행되지 않은 줄 장면을 끼운다(값은 바로 앞 장면 그대로).
// - 장면 기록은 문장 줄(;로 끝남) 뒤와 블록 시작({로 끝남) 바로 뒤에 끼운다. tools/verify_trace.mjs와 같은 방식이라 검사와 어긋나지 않는다.
// - 비동기(await) 문제는 이 도구를 쓰지 않는다(줄 순서와 실행 순서가 달라서). 함수 값은 장면에 넣지 않는다.
import vm from 'node:vm';

export const fmt = (v) => (typeof v === 'string' ? (v.includes('"') ? "'" + v + "'" : JSON.stringify(v)) : (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v)));

export function buildTrace(code, vars, notes, extras = []) {
  const grab = `{${vars.map((n) => `${JSON.stringify(n)}: (() => { try { return ${n}; } catch { return undefined; } })()`).join(', ')}}`;
  const lines = code.map((l, i) => { const t = l.trim(); return t.endsWith('{') || t.endsWith(';') ? `${l} __p(${i}, ${grab});` : l; });
  const out = [];
  const ev = [];
  vm.runInContext(lines.join('\n'), vm.createContext({
    console: { log: (...a) => out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) },
    __p: (line, v) => ev.push({ line, vars: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && typeof x !== 'function').map(([k, x]) => [k, fmt(x)])), out: [...out] }),
  }), { timeout: 1000 });
  const seen = {};
  const scenes = [];
  for (const e of ev) {
    const occ = (seen[e.line] = (seen[e.line] ?? -1) + 1);
    scenes.push({ line: e.line, vars: e.vars, out: e.out, note: notes[`${e.line}#${occ}`] ?? notes[String(e.line)] });
    for (const x of extras) if (x.after[0] === e.line && x.after[1] === occ) scenes.push({ line: x.line, vars: e.vars, out: e.out, note: x.note });
  }
  for (const s of scenes) if (!s.note) throw new Error(`설명 없음: ${s.line + 1}번 줄`);
  return { trace: scenes, original: out };
}
