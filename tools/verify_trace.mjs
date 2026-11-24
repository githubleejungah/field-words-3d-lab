// 쓰는 법: node tools/verify_trace.mjs docs/candidates/problems-candidates.json [문제 id ...]
// 실행 장면(trace)을 실제 실행과 맞춰 본다: 문장 줄 뒤 · 블록 시작 직후에 기록 호출을 끼워 실행한다.
// 거짓이 된 조건 줄(블록에 들어가지 않은 장면)은 직전 상태와 같은지 본다.
import fs from 'node:fs';
import vm from 'node:vm';
const file = process.argv[2];
const ids = process.argv.slice(3);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const fmt = (v) => (typeof v === 'string' ? (v.includes('"') ? "'" + v + "'" : JSON.stringify(v)) : (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v)));
let bad = 0;
for (const p of data.problems.filter((x) => !ids.length || ids.includes(x.id))) {
  const names = [...new Set(p.trace.flatMap((s) => Object.keys(s.vars)))];
  const grab = `{${names.map((n) => `${JSON.stringify(n)}: (() => { try { return ${n}; } catch { return undefined; } })()`).join(', ')}}`;
  const lines = p.code.map((l, i) => {
    const t = l.trim();
    if (t.endsWith('{')) return `${l} __p(${i}, ${grab});`;
    if (t.endsWith(';')) return `${l} __p(${i}, ${grab});`;
    return l;
  });
  const out = [];
  const events = [];
  const ctx = vm.createContext({ console: { log: (...a) => out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }, __p: (line, vars) => events.push({ line, vars: Object.fromEntries(Object.entries(vars).filter(([, v]) => v !== undefined).map(([k, v]) => [k, fmt(v)])), out: [...out] }), String });
  try { vm.runInContext(lines.join('\n'), ctx, { timeout: 1000 }); } catch (e) { console.log(p.id, '실행 실패', e.message); bad++; continue; }
  let ptr = 0, last = { vars: {}, out: [] }, ok = 0;
  for (const [k, s] of p.trace.entries()) {
    let ref;
    if (ptr < events.length && events[ptr].line === s.line) { ref = events[ptr++]; } else { ref = last; }
    const want = JSON.stringify(Object.fromEntries(Object.keys(s.vars).sort().map((n) => [n, s.vars[n]])));
    const got = JSON.stringify(Object.fromEntries(Object.keys(s.vars).sort().map((n) => [n, ref.vars[n]])));
    const sameOut = JSON.stringify(ref.out) === JSON.stringify(s.out);
    if (want !== got || !sameOut) { bad++; console.log(`  ✗ ${p.id} 장면 ${k + 1}(${s.line + 1}번 줄) 변수 ${got} ≠ ${want} / 출력 ${JSON.stringify(ref.out)} ≠ ${JSON.stringify(s.out)}`); } else ok++;
    last = ref;
  }
  const left = events.length - ptr;
  if (left) { bad++; console.log(`  ✗ ${p.id} 장면에 없는 실행 ${left}곳: ${events.slice(ptr).map((e) => e.line + 1).join(',')}번 줄`); }
  console.log(`${p.id}: 장면 ${ok}/${p.trace.length} 일치${left ? '' : ', 빠진 실행 없음'}`);
}
process.exit(bad ? 1 : 0);
