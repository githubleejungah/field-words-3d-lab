// 코드 가려 보기 — 예제 실행 (ADR-0002)
// 실행할 때마다 Web Worker(화면과 따로 도는 일꾼)를 새로 만들고, 1초 안에 답이 없으면 일꾼째 멈춘다(AC-67).
// 일꾼을 만들 수 없거나 코드 실행이 막히면 문제 데이터에 저장한 출력을 쓴다(AC-64).
// 출력 글자 규칙은 tools/check_problems.mjs와 같다(data-model 2-3).

export const RUN_LIMIT_MS = 1000;

const WORKER_SRC = `
self.onmessage = (e) => {
  const out = [];
  const fmt = (a) => a.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ');
  const console = { log: (...a) => out.push(fmt(a)) };
  let fn;
  try { fn = new Function('console', e.data.src); }
  catch (err) {
    const blocked = err instanceof EvalError || /unsafe-eval|Content Security/i.test(String(err && err.message));
    self.postMessage({ ok: false, kind: blocked ? 'blocked' : 'syntax', error: String(err && err.message), out });
    return;
  }
  let failed = null;
  const onAsyncError = (ev) => { failed = String(ev.reason && ev.reason.message || ev.reason); };
  self.addEventListener('unhandledrejection', onAsyncError);
  try { fn(console); }
  catch (err) { self.postMessage({ ok: false, kind: 'runtime', error: String(err && err.message), out }); return; }
  // 비동기(async · await) 예제: 마이크로태스크가 다 끝나고, 처리되지 않은 오류 알림(unhandledrejection)까지
  // 받은 뒤에 출력을 돌려준다. 알림은 별도 작업으로 오기 때문에 한 번 더 미룬다(검사 도구와 같은 결과).
  setTimeout(() => setTimeout(() => {
    if (failed) self.postMessage({ ok: false, kind: 'runtime', error: failed, out });
    else self.postMessage({ ok: true, out });
  }, 0), 0);
};`;

let workerUrl = null;
function makeWorker() {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return null;
  try {
    if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    return new Worker(workerUrl);
  } catch {
    return null;
  }
}

// lines: 실행할 코드 줄, saved: 실행이 막힐 때 보여 줄 저장 출력(없으면 null)
// 돌려주는 값: { out, live, kind?, error? }  live=false면 "미리 실행한 결과"
export function run(lines, saved = null) {
  const fallback = (kind) => (saved ? { out: saved, live: false, kind } : { out: [], live: false, kind, error: '실행할 수 없어요' });
  const w = makeWorker();
  if (!w) return Promise.resolve(fallback('blocked'));
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); w.terminate(); resolve(r); };
    const timer = setTimeout(() => finish({ out: [], live: true, kind: 'timeout', error: '실행이 너무 길어 멈췄어요' }), RUN_LIMIT_MS);
    w.onmessage = (e) => {
      const r = e.data;
      if (r.ok) finish({ out: r.out, live: true });
      else if (r.kind === 'blocked') finish(fallback('blocked'));
      else finish({ out: r.out, live: true, kind: r.kind, error: r.error });
    };
    w.onerror = (e) => { e.preventDefault?.(); finish(fallback('blocked')); };
    w.postMessage({ src: lines.join('\n') });
  });
}

export const maskedLines = (code, line) => code.filter((_, i) => i !== line);
