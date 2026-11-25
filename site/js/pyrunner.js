// 코드 가려 보기 — 파이썬 실행기 (Pyodide, ADR-0007)
// 근거: docs/architecture.md 4-1 · 5-3b, docs/flows.md 15장, 수용 기준 AC-100 · 105 · 108 · 109 · 111 · 112 · 113.
// - 동의한 뒤 start()를 부를 때만 Web Worker 1개를 만들고, 그 안에서 jsDelivr의 버전 고정 Pyodide를 받는다.
//   부르기 전에는 바깥 요청이 0번이다(AC-100).
// - 켠 일꾼은 다시 쓴다. 한 번 실행이 1초를 넘으면 일꾼째 멈추고, 다음 실행 때 다시 켠다(AC-112).
// - 받지 못하면 그 페이지에서는 다시 받지 않는다(AC-111). 실행할 수 없으면 저장 출력으로 돌아간다.
// - 실행 도우미는 개발자 PC 검사 도구와 같은 파일(site/py/cm_run.py)을 쓴다.

export const PYODIDE_VERSION = '314.0.8';
export const PYODIDE_URL = `https://cdn.jsdelivr.net/npm/pyodide@${PYODIDE_VERSION}/`;
export const RUN_LIMIT_MS = 1000; // runner.js와 같은 1초 (AC-67 · 112)

// 일꾼 안 코드: init 메시지로 주소를 받은 뒤에 받기를 시작한다(blob 일꾼에서는 상대 주소가 안 통해서 절대 주소를 넘긴다)
// Pyodide 314는 모듈 일꾼만 지원한다(2026-11-25 확인: 클래식 일꾼은 "Classic web workers are not supported").
const WORKER_MAIN = `
let py = null, ready = null;
function boot(pyodideUrl, helperUrl) {
  ready = (async () => {
    const m = await import(pyodideUrl + 'pyodide.mjs');
    py = await m.loadPyodide({ indexURL: pyodideUrl });
    const helper = await (await fetch(helperUrl, { referrerPolicy: 'no-referrer' })).text();
    py.runPython(helper);
  })();
  ready.then(() => self.postMessage({ type: 'ready' }), (err) => self.postMessage({ type: 'loadfail', error: String(err && err.message || err) }));
}
self.onmessage = async (e) => {
  const d = e.data;
  if (d.type === 'init') { boot(d.pyodideUrl, d.helperUrl); return; }
  if (d.type === 'run') {
    try {
      await ready;
      const fn = py.globals.get('cm_run');
      const res = fn(d.src, d.names ? py.toPy(d.names) : undefined, d.lineMap ? py.toPy(d.lineMap) : undefined); // undefined → None (null은 JsNull이 됨)
      const obj = res.toJs({ dict_converter: Object.fromEntries });
      res.destroy(); fn.destroy();
      self.postMessage({ type: 'result', id: d.id, res: obj });
    } catch (err) {
      self.postMessage({ type: 'result', id: d.id, res: { ok: false, kind: 'blocked', error: String(err && err.message || err), out: [] } });
    }
  }
};
`;

// status: idle(아직 안 받음) · loading · ready · failed(이 페이지에서는 다시 받지 않음)
let worker = null;
let status = 'idle';
let readyPromise = null;
let seq = 0;
const waiting = new Map();
const listeners = new Set();
const setStatus = (s) => { status = s; listeners.forEach((fn) => fn(s)); };
export const getStatus = () => status;
export const onStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function makeWorker() {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return null;
  try { return new Worker(URL.createObjectURL(new Blob([WORKER_MAIN], { type: 'text/javascript' })), { type: 'module' }); } catch { return null; }
}

// 받기 시작 (동의한 뒤에만 부른다). 이미 받는 중 · 받았으면 그대로. 실패한 페이지에서는 다시 받지 않는다.
export function start() {
  if (status === 'loading' || status === 'ready') return readyPromise;
  if (status === 'failed') return Promise.resolve(false);
  const w = makeWorker();
  if (!w) { setStatus('failed'); return Promise.resolve(false); }
  worker = w;
  setStatus('loading');
  readyPromise = new Promise((resolve) => {
    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'ready') { setStatus('ready'); resolve(true); }
      else if (d.type === 'loadfail') { stop('failed'); resolve(false); }
      else if (d.type === 'result') { const cb = waiting.get(d.id); if (cb) cb(d.res); }
    };
    w.onerror = (e) => { e.preventDefault?.(); stop('failed'); resolve(false); };
  });
  w.postMessage({ type: 'init', pyodideUrl: PYODIDE_URL, helperUrl: new URL('py/cm_run.py', location.href).href });
  return readyPromise;
}

function stop(next) {
  if (worker) worker.terminate();
  worker = null;
  for (const cb of waiting.values()) cb({ ok: false, kind: 'blocked', error: '멈춤', out: [] });
  waiting.clear();
  setStatus(next);
}

// 준비될 때까지 기다린다(받는 중이 아니면 바로 false)
export const whenReady = () => (status === 'ready' ? Promise.resolve(true) : status === 'loading' ? readyPromise : Promise.resolve(false));

// 한 번 실행. 돌려주는 값은 runner.js run()과 같은 모양: { out, live, kind?, error?, trace? }
// saved: 실행할 수 없을 때 보여 줄 저장 출력(없으면 null)
export async function runPy(lines, saved = null, { names = null, lineMap = null } = {}) {
  const fallback = (kind) => (saved ? { out: saved, live: false, kind } : { out: [], live: false, kind, error: '실행할 수 없어요' });
  if (status === 'idle' && worker === null && readyPromise) start(); // 1초를 넘어 멈춘 뒤: 다음 실행 때 다시 켬
  if (status !== 'ready') {
    const ok = status === 'loading' ? await readyPromise : false;
    if (!ok) return fallback('blocked');
  }
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      stop('idle'); // 일꾼째 멈춤. 받은 파일은 브라우저에 남아 다음에 빨리 켠다
      resolve({ out: [], live: true, kind: 'timeout', error: '실행이 너무 길어 멈췄어요' });
    }, RUN_LIMIT_MS);
    waiting.set(id, (res) => {
      clearTimeout(timer);
      waiting.delete(id);
      if (res.ok) resolve({ out: res.out, live: true, trace: res.trace });
      else if (res.kind === 'blocked') resolve(fallback('blocked'));
      else resolve({ out: res.out || [], live: true, kind: res.kind, error: res.error });
    });
    worker.postMessage({ type: 'run', id, src: lines.join('\n'), names, lineMap });
  });
}
