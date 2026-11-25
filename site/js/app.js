// 코드 가려 보기 — 화면 그리기 · 화면 이동
// 근거: docs/flows.md 1 · 3 · 5 · 6 · 7장, docs/architecture.md 4-1.
// 규칙은 review.js · grade.js · plan.js에 있고, 이 파일은 그리기와 순서만 맡는다.
// 학습자 화면에는 규칙 설명 글을 두지 않는다(Q18). 글자는 모두 textContent로 넣는다(innerHTML 안 씀).

import * as R from './review.js';
import * as G from './grade.js';
import * as P from './plan.js';
import * as S from './store.js';
import { run, maskedLines, isAsync, tracedLines } from './runner.js';
import * as RD from './reading.js';
import * as T from './tower.js';

const FW_BASE = 'https://githubleejungah.github.io/field-words/';
// 배포하면 같은 주소 아래 필드워드 사전을 읽는다(A12 · AS-8). 개발 중에는 상위 폴더에서 서버를 띄우면 두 번째 주소로 읽힌다.
const GLOSSARY_URLS = ['/field-words/data/glossary.json', '/field-words/site/data/glossary.json'];
const MORE_STEPS = 5; // 목표를 채운 뒤 "더 하기" (필드워드 app.js와 같은 5)
const CONF = [['sure', '확실해요'], ['unsure', '헷갈려요'], ['dontknow', '몰라요']];
const STATUS_KO = { known: '✅ 앎', shaky: '🟡 불안', confused: '🟠 헷갈림', misconception: '🚨 착각', unknown: '⚪ 모름' };
const STAGE_KO = { 1: '① 해석 보기', 2: '② 가려 보기', 3: '③ 해석 고르기' };

const state = { problems: [], byId: new Map(), words: {}, glossary: null, round: null, readings: [], reading: null };
const $app = document.getElementById('app');

// ---------- 작은 도구 ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}
const btn = (label, onclick, cls = 'btn') => h('button', { type: 'button', class: cls, onclick }, label);
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// 글 속 코드처럼 생긴 부분(영문 이름 · 기호)을 코드 글꼴로 바꾼다. 코드와 친해지게(2026-11-22 결정).
const CODE_RE = /(!?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\[[\w$]*\])?(?:\([\w$, ]*\))?|===|!==|&&|\|\||=>|(?<![=!<>])=(?![=>]))/g;
function codeText(text) {
  const str = String(text);
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of str.matchAll(CODE_RE)) {
    if (m.index > last) frag.append(str.slice(last, m.index));
    frag.append(h('code', { class: 'ic' }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < str.length) frag.append(str.slice(last));
  return frag;
}
// ② 보기: 출력 줄(out)이 있으면 출력 모양으로, 없으면 글로. ③ 보기: 코드 조각 + 뜻
function outLines(lines) {
  return h('span', { class: 'opt-out' }, lines.length ? lines.join('\n') : '(출력 없음)');
}
// 답한 뒤 보기에 붙일 글자: 색만으로 구분하지 않는다 (AC-13d)
function optBadge(o, picked, shown) {
  if (!shown) return null;
  const isPick = picked === o;
  if (o.correct && isPick) return h('span', { class: 'opt-badge ok' }, '✓ 정답 · 내 선택');
  if (o.correct) return h('span', { class: 'opt-badge ok' }, '✓ 정답');
  if (isPick) return h('span', { class: 'opt-badge no' }, '✗ 내 선택');
  return null;
}
const withBadge = (body, badge) => (badge ? h('span', { class: 'opt-row' }, body, badge) : body);

function optionBody(o, isMask) {
  if (isMask) return Array.isArray(o.out) ? outLines(o.out) : codeText(o.text);
  return h('span', { class: 'opt-two' }, o.code ? h('code', { class: 'opt-code' }, o.code) : null, h('span', {}, codeText(o.text)));
}
const optLabel = (o) => (Array.isArray(o.out) ? (o.out.length ? o.out.join(' / ') : '출력 없음') : (o.code ? `${o.code} — ${o.text}` : o.text));

// 화면 그리기. 같은 단계 안에서 다시 그릴 때(다음 줄 실행 · 보기 고르기 · 도움 판 열기)는 화면 위치를 그대로 두고,
// 단계 · 문제 · 화면이 바뀔 때만 맨 위로 올린다. 누를 때마다 맨 위로 튀지 않게(2026-11-22 결정).
let lastViewKey = null;
function viewKey() {
  const rd = state.round;
  // 실전 읽기는 같은 단계 안에서 점을 고를 때 화면 위치를 그대로 둔다
  if (!rd && state.reading && location.hash === '#/reading') return `reading:${state.reading.phase}`;
  if (!rd) return `${location.hash}:${Math.random()}`; // 한 판 밖의 화면은 늘 맨 위에서
  return `${rd.p.id}:${rd.stageIdx}:${rd.retry ? rd.retry.phase : ''}:${rd.again ? 'again' : ''}`;
}
function show(...nodes) {
  const key = viewKey();
  const y = window.scrollY;
  $app.replaceChildren(...nodes.filter(Boolean));
  window.scrollTo(0, key === lastViewKey ? y : 0);
  lastViewKey = key;
}
// 보기 · 결과가 화면 밖에 나오면 보이는 곳까지만 바로 내려 준다
function reveal(sel) {
  const el = document.querySelector(sel);
  if (el) el.scrollIntoView({ block: 'nearest' });
}
function notice(text) { const n = document.getElementById('notice'); n.textContent = text; n.hidden = !text; }

// ---------- 데이터 읽기 ----------
// 사이트도 문제를 읽을 때 모양을 가볍게 다시 검사해서, 깨진 문제는 내지 않는다(AC-66).
function validProblem(p) {
  try {
    const n = p.code.length;
    return typeof p.id === 'string' && n >= 3 && n <= 10 && p.explain.length === n && p.ko.length === n &&
      Array.isArray(p.trace) && p.trace.length > 0 && Array.isArray(p.masks) && p.masks.length === 2 &&
      p.masks.every((m) => m.line >= 0 && m.line < n && ['predict', 'interpret'].every((q) =>
        m[q].options.length === 4 && m[q].options.filter((o) => o.correct === true).length === 1));
  } catch { return false; }
}

async function loadGlossary() {
  for (const url of GLOSSARY_URLS) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const g = await r.json();
      return new Map(g.terms.map((t) => [t.id, t]));
    } catch { /* 다음 주소 */ }
  }
  return null; // 못 읽으면 비유 · 용어 이름만 숨긴다(flows 10장)
}

async function boot() {
  try {
    const [pd, wd] = await Promise.all([fetch('data/problems.json').then((r) => r.json()), fetch('data/words.json').then((r) => r.json())]);
    state.problems = pd.problems.filter(validProblem);
    state.byId = new Map(state.problems.map((p) => [p.id, p]));
    state.words = wd.words || {};
  } catch {
    show(h('p', { class: 'card' }, '문제를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.'));
    return;
  }
  if (!S.persistent) notice('이번 기록은 저장되지 않아요');
  // 실전 읽기 코드: 못 읽거나 깨졌으면 카드만 숨기고 게임은 그대로(flows 10장)
  try { state.readings = ((await (await fetch('data/reading.json')).json()).readings || []).filter(RD.validReading); } catch { state.readings = []; }
  state.glossary = await loadGlossary();
  window.addEventListener('hashchange', route);
  route();
}

function route() {
  const hash = location.hash || '#/';
  if (hash === '#/play') playNext();
  else if (hash === '#/reading') readingScreen();
  else if (hash === '#/tower') towerScreen();
  // 배치 시험은 한 번만(흐름 11장). 기록이 있으면 뒤로 가기 · 주소로 와도 다시 열지 않는다 — 등급 덮어쓰기 방지(AC-40, Q30)
  else if (hash === '#/placement' && S.read('placement', null)) { history.replaceState(null, '', '#/'); home(); }
  else if (hash === '#/placement') placement();
  else home();
  updateTodayBar();
}
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
// 주소 기록을 바꿔 쓰며 이동: 뒤로 가기가 지나온 화면(실력 확인)으로 돌아가지 않게
const goReplace = (hash) => { if (location.hash === hash) route(); else location.replace(hash); };

// ---------- 공통 계산 ----------
function context() {
  const day = S.today();
  const records = S.allRecords(state.problems);
  const placementRec = S.read('placement', null);
  const today = S.getToday(day);
  return { day, records, placement: placementRec, today };
}
function planNow(ctx = context()) {
  return P.dailyPlan({ problems: state.problems, records: ctx.records, day: ctx.day, today: ctx.today, placement: ctx.placement, extra: ctx.today.extra || 0 });
}
function updateTodayBar() {
  const ctx = context();
  const goal = P.DAILY_GOAL + (ctx.today.extra || 0);
  document.getElementById('todayBar').textContent = `오늘 ${Math.min(ctx.today.steps_done, goal)} / ${goal}`;
}
function startLevel(ctx) { return (ctx.placement && ctx.placement.start_level) || 1; }
function termName(id) { const t = state.glossary && state.glossary.get(id); return t ? t.term_ko : null; }

// ---------- 처음 화면 ----------
function home() {
  const ctx = context();
  if (!ctx.placement) {
    show(h('section', { class: 'card' },
      h('h2', {}, '어디서부터 시작할까요?'),
      h('p', { class: 'muted' }, '실력 확인 문제를 풀면 맞는 등급부터 시작해요.'),
      h('div', { class: 'row' },
        btn('실력 확인 풀기', () => go('#/placement')),
        btn('건너뛰고 입문부터', () => {
          S.write('placement', P.placementResult({}, { skipped: true }));
          S.write('grade', { level: 1, milestones_shown: 0 });
          home(); updateTodayBar();
        }, 'btn ghost'))));
    return;
  }

  const plan = planNow(ctx);
  const goal = plan.goal;
  const done = Math.min(ctx.today.steps_done, goal);
  const todayCard = h('section', { class: 'card' },
    h('div', { class: 'row between' }, h('h2', {}, '오늘 할 일'), h('span', { class: 'tnum muted' }, `${done} / ${goal}단계`)),
    h('div', { class: 'track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': goal, 'aria-valuenow': done },
      h('div', { class: 'fill', style: `width:${Math.round((done / goal) * 100)}%` })));
  if (plan.queue.length) {
    todayCard.append(h('div', { class: 'row' }, btn(ctx.today.steps_done ? '이어서 풀기' : '시작하기', () => go('#/play'))));
  } else if (ctx.today.steps_done >= goal) {
    const morePlan = P.dailyPlan({ problems: state.problems, records: ctx.records, day: ctx.day, today: ctx.today, placement: ctx.placement, extra: (ctx.today.extra || 0) + MORE_STEPS });
    todayCard.append(h('p', {}, '오늘 목표를 채웠어요.'));
    if (morePlan.queue.length) todayCard.append(h('div', { class: 'row' }, btn(`${MORE_STEPS}단계 더 하기`, () => {
      S.setToday({ ...ctx.today, extra: (ctx.today.extra || 0) + MORE_STEPS }); go('#/play');
    }, 'btn ghost')));
  } else {
    todayCard.append(h('p', {}, '오늘 풀 문제를 다 풀었어요. 내일 또 만나요.'));
  }

  const grade = S.read('grade', null) || { level: startLevel(ctx), milestones_shown: 0 };
  const prog = G.levelProgress(state.problems, ctx.records, grade.level);
  const mis = G.misCount(ctx.records);
  const gradeCard = h('section', { class: 'card' },
    h('div', { class: 'row between' }, h('h2', {}, '코드 등급'), h('span', { class: 'lv' }, G.LEVEL_NAMES[grade.level])),
    prog.total ? h('div', { class: 'stats' },
      h('div', { class: 'row' }, h('span', {}, `${G.LEVEL_NAMES[grade.level]} 익힘`), h('span', { class: 'tnum' }, `${prog.learned} / ${prog.need}`)),
      h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${Math.round((Math.min(prog.learned, prog.need) / Math.max(prog.need, 1)) * 100)}%` }))) : null,
    mis ? h('p', {}, `🚨 확인할 착각 ${mis}개`) : null);

  const log = S.read('log', {});
  const validation = S.read('validation', null);
  const first = G.weekStart(validation, log); // 검증 시작일이 있으면 그날부터, 없으면 처음 답한 날부터 (AC-90 · 91)
  let ratioCard = null;
  if (first && first <= ctx.day) {
    const weeks = G.weeklyMisRatio(log, first, ctx.day);
    const cur = weeks[weeks.length - 1];
    if (cur.ratio !== null) ratioCard = h('p', { class: 'muted' }, `이번 주 착각 비율 ${Math.round(cur.ratio * 100)}% (${cur.misconceptions} / ${cur.answers})`);
  }
  show(todayCard, towerCard(ctx), readingCard(ctx), gradeCard, ratioCard, validationRow(validation, log, ctx.day));
}

// ---------- 4주 변화 재기 (flows 13장, AC-89~94) ----------
// 시작하면 28일 동안 다시 시작할 수 없어서, 시작 · 다시 재기는 한 번 더 확인한다. 규칙 설명 글은 두지 않는다(AC-71).
const pct = (w) => (w && w.ratio !== null ? `${Math.round(w.ratio * 100)}%` : '답 없음');
function validationRow(validation, log, day) {
  const view = G.validationView(validation, log, day);
  if (view.state === 'running') return h('p', { class: 'muted tnum' }, `4주 변화 재기 ${view.week}주차`); // 다시 시작 버튼 없음 (AC-92)
  const wrap = h('div', { class: 'validation' });
  const ask = (label) => {
    const confirmRow = h('div', { class: 'row' },
      btn('시작', () => { S.write('validation', G.startValidation(S.read('validation', null), S.read('log', {}), S.today())); home(); }),
      btn('취소', () => wrap.replaceChildren(...base()), 'btn ghost small'));
    return btn(label, () => wrap.replaceChildren(h('p', {}, '오늘부터 4주를 재요. 시작할까요?'), confirmRow), 'btn ghost small');
  };
  const base = () => (view.state === 'done'
    ? [h('p', { class: 'tnum' }, `1주차 착각 ${pct(view.week1)} → 4주차 ${pct(view.week4)}`), h('div', { class: 'row' }, ask('다시 재기'))] // AC-93 · 94
    : [h('div', { class: 'row' }, ask('4주 변화 재기 시작'))]); // AC-89
  wrap.append(...base());
  return wrap;
}

// ---------- 실전 읽기 확인 (flows 12장, AC-77~85) ----------
// 게임 기록과 따로 잰다: 복습 상자 · 하루 단계 · 등급에 넣지 않는다(AC-84). 학습자 화면에 규칙 글은 두지 않는다(AC-71).
const READ_Q = [['what', '무엇을 하는 코드인가요?'], ['io', '무엇을 받아서 무엇을 내놓나요?'], ['key', '가장 중요한 줄은 몇 번이고, 왜 그런가요?']];
const MARK_KO = [['hit', '맞힘'], ['partial', '부분'], ['miss', '놓침']];
const LANG_KO = { typescript: 'TypeScript', javascript: 'JavaScript' };

// 회차 순서 기록 한 줄: "실전 읽기 1회 63% · 2회 70%" (AC-83)
function readingLine(rec) {
  const hist = RD.readingHistory(rec);
  if (!hist.length) return null;
  return h('p', { class: 'muted tnum' }, '실전 읽기 ', hist.map((x) => `${x.n}회 ${x.percent}%${x.repeat ? '(다시 읽음)' : ''}`).join(' · '));
}

// 처음 화면 카드: 기록 0회이거나 마지막 회차 뒤 28일이 지났을 때만(AC-77 · 78). 다른 일을 막지 않는다.
function readingCard(ctx) {
  const rec = S.read('reading', null);
  if (!state.readings.length || !RD.readingDue(rec, ctx.placement, ctx.day)) return readingLine(rec);
  return h('section', { class: 'card' },
    h('h2', {}, '실전 읽기 확인'),
    h('p', { class: 'muted' }, '도움 없이 진짜 코드를 읽어 봐요.'),
    readingLine(rec),
    h('div', { class: 'row' }, btn('읽어 보기', () => go('#/reading'))));
}

function readingScreen() {
  const ctx = context();
  if (!state.reading) {
    // 할 때가 아니면(주소로 바로 와도) 처음 화면으로
    if (!state.readings.length || !RD.readingDue(S.read('reading', null), ctx.placement, ctx.day)) { goReplace('#/'); return; }
    const pick = RD.pickReading(state.readings, S.read('reading', null));
    state.reading = { ...pick, phase: 'read', answers: { what: '', io: '', key: '' }, marks: [], score: null };
  }
  renderReading();
}

// 코드와 줄 번호만. 이름표 · 조각 풀이 · 궁금해요 · 실행 버튼은 두지 않는다(AC-79 · 80)
function readCode(code, keyLine = null) {
  const box = h('div', { class: 'code', role: 'region', 'aria-label': '코드' });
  code.forEach((line, i) => box.append(h('div', { class: 'ln' + (i === keyLine ? ' cur' : '') },
    h('span', { class: 'n' }, String(i + 1)), h('span', { class: 'c' }, line || ' '))));
  return box;
}

function renderReading() {
  const st = state.reading;
  const { reading } = st;
  const quit = () => btn('그만두기', () => { state.reading = null; go('#/'); }, 'btn ghost'); // 기록을 남기지 않는다
  const head = h('div', { class: 'meta' }, h('span', { class: 'lv' }, '실전 읽기'), h('span', {}, LANG_KO[reading.lang] || reading.lang),
    st.repeat ? h('span', {}, '다시 읽음') : null);

  if (st.phase === 'read') {
    show(h('section', { class: 'card' }, head, h('p', { class: 'muted' }, '도움 없이 읽어 보세요.'), readCode(reading.code),
      h('div', { class: 'row' }, btn('다 읽었어요 ▶', () => { st.phase = 'write'; renderReading(); reveal('.rd-field'); }), quit())));
    return;
  }

  if (st.phase === 'write') {
    // 3칸을 모두 적어야 답 보기가 눌린다 (AC-81 · 82)
    const submit = btn('답 보기 ▶', () => { st.phase = 'mark'; st.marks = reading.points.map(() => null); renderReading(); reveal('.rd-pair'); });
    const sync = () => { submit.disabled = !READ_Q.every(([k]) => st.answers[k].trim()); };
    const fields = READ_Q.map(([k, q]) => {
      const ta = h('textarea', { id: `rd-${k}`, class: 'rd-text', rows: 3 });
      ta.value = st.answers[k];
      ta.addEventListener('input', () => { st.answers[k] = ta.value; sync(); });
      return h('div', { class: 'rd-field' }, h('label', { for: `rd-${k}` }, q), ta);
    });
    sync();
    show(h('section', { class: 'card' }, head, readCode(reading.code), ...fields, h('div', { class: 'row' }, submit, quit())));
    return;
  }

  if (st.phase === 'mark') {
    // 칸마다 내 답 | 모범 답, 꼭 짚을 점마다 맞힘 · 부분 · 놓침 (AC-82). AI 채점 없음(AC-02)
    const m = reading.model;
    const modelOf = { what: m.what, io: m.io, key: `${m.key.line + 1}번 줄 — ${m.key.why}` };
    const pairs = READ_Q.map(([k, q]) => h('div', { class: 'rd-pair' }, h('p', { class: 'q' }, q),
      h('div', { class: 'pair' },
        h('div', { class: 'box' }, h('span', { class: 'box-t' }, '내 답'), h('p', { class: 'rd-mine' }, st.answers[k])),
        h('div', { class: 'box' }, h('span', { class: 'box-t' }, '모범 답'), h('p', {}, codeText(modelOf[k]))))));
    const points = h('ol', { class: 'rd-points' }, ...reading.points.map((pt, i) => h('li', {}, h('p', {}, codeText(pt)),
      h('div', { class: 'row', role: 'group', 'aria-label': `${i + 1}번 점` }, ...MARK_KO.map(([mk, label]) => h('button', {
        type: 'button', class: 'btn small' + (st.marks[i] === mk ? '' : ' ghost'), 'aria-pressed': st.marks[i] === mk ? 'true' : 'false',
        onclick: () => { st.marks[i] = mk; renderReading(); },
      }, label))))));
    const save = btn('기록하기', () => {
      const rec = RD.addRun(S.read('reading', null), { reading_id: reading.id, day: context().day, answers: st.answers, marks: st.marks.map((k) => RD.MARK[k]), repeat: st.repeat });
      S.write('reading', rec); // 실전 읽기 키에만 쓴다 (AC-84)
      st.score = rec.runs[rec.runs.length - 1].score;
      st.phase = 'done';
      renderReading();
    });
    save.disabled = !st.marks.every(Boolean);
    show(h('section', { class: 'card' }, head, readCode(reading.code, m.key.line), ...pairs,
      h('p', { class: 'q' }, '꼭 짚을 점'), points, h('div', { class: 'row' }, save, quit())));
    return;
  }

  // 끝: 이번 점수와 회차 순서 기록 (AC-83)
  show(h('section', { class: 'card' }, head, h('h2', {}, `이번 점수 ${Math.round(st.score * 100)}%`), readingLine(S.read('reading', null)),
    h('div', { class: 'row' }, btn('처음으로', () => { state.reading = null; go('#/'); }))));
}

// ---------- 배치 시험 (flows 1장) ----------
function placement() {
  const items = P.placementProblems(state.problems);
  const answers = {};
  let i = 0;
  const next = () => {
    if (i >= items.length) return finish();
    const it = items[i];
    const p = state.byId.get(it.id);
    const m = p.masks[it.mask];
    const opts = h('div', { class: 'opts' });
    for (const o of shuffle(m.predict.options)) {
      opts.append(h('button', { type: 'button', class: 'opt', 'aria-label': optLabel(o), onclick: () => { answers[it.level] = o.correct === true; i += 1; next(); } }, optionBody(o, true)));
    }
    show(h('section', { class: 'card' },
      h('div', { class: 'meta' }, h('span', {}, `실력 확인 ${i + 1} / ${items.length}`), h('span', { class: 'lv' }, G.LEVEL_NAMES[p.level])),
      codeView(p, { maskLine: m.line }),
      h('p', { class: 'q' }, `${m.line + 1}번 줄을 가리고 실행하면 무엇이 출력될까요?`),
      opts,
      h('div', { class: 'row' }, btn('잘 모르겠어요', () => { answers[it.level] = false; i += 1; next(); }, 'btn ghost small'))));
  };
  const finish = () => {
    const res = P.placementResult(answers);
    S.write('placement', res);
    S.write('grade', { level: res.start_level, milestones_shown: 0 });
    updateTodayBar();
    // 시작 전에 내 등급과 등급마다 맞힘 · 틀림을 먼저 보여 준다 (AC-47d · 47e, Q29)
    const marks = h('ul', { class: 'place-result', 'aria-label': '등급마다 결과' },
      ...items.map((it) => {
        const ok = answers[it.level] === true;
        return h('li', { class: ok ? 'ok' : 'no' }, h('span', {}, G.LEVEL_NAMES[it.level]),
          h('b', { 'aria-label': ok ? '맞힘' : '틀림' }, ok ? '✓' : '✗'));
      }));
    show(h('section', { class: 'card' },
      h('h2', {}, `내 코드 등급: ${G.LEVEL_NAMES[res.start_level]}`),
      marks,
      h('div', { class: 'row' }, btn('시작하기', () => goReplace('#/play')),
        // 실전 읽기 기준값을 1번 권한다 (AC-77)
        state.readings.length ? btn('실전 읽기 먼저 하기', () => goReplace('#/reading'), 'btn ghost') : null)));
  };
  next();
}

// ---------- 코드 그리기 ----------
// opts: maskLine(가린 줄), cur(지금 줄), labels(덩어리 이름표, ①에서만 — AC-55 · 56),
//       keys(이 코드 속 용어 줄 표시 — 답하기 전 ② · ③에서는 끈다)
function codeView(p, { maskLine = null, cur = null, labels = false, keys = false } = {}) {
  const box = h('div', { class: 'code', role: 'region', 'aria-label': '코드' });
  const labelAt = new Map((labels ? p.labels : []).map((l) => [l.from, l.text]));
  const keyLines = new Set(keys && p.in_code ? p.in_code.flatMap((it) => it.lines) : []);
  p.code.forEach((line, i) => {
    if (labelAt.has(i)) box.append(h('div', { class: 'ln lab' }, labelAt.get(i)));
    const cls = ['ln'];
    if (i === cur) cls.push('cur');
    if (keyLines.has(i)) cls.push('key');
    if (i === maskLine) cls.push('masked');
    box.append(h('div', { class: cls.join(' '), ...(i === maskLine ? { 'aria-label': `${i + 1}번 줄 가림` } : {}) },
      h('span', { class: 'n' }, String(i + 1)), h('span', { class: 'c' }, i === maskLine ? '▒'.repeat(Math.max(line.length, 4)) : (line || ' '))));
  });
  return box;
}

// 두 출력을 나란히, 서로 다른 줄은 색으로 (AC-19 · 20)
function compareView(orig, masked, line) {
  const n = Math.max(orig.out.length, masked.out.length);
  const col = (r, title) => {
    const out = h('div', { class: 'out' });
    if (r.kind === 'timeout') out.append(h('span', { class: 'diff' }, r.error));
    else if (r.kind === 'runtime' || r.kind === 'syntax') out.append(h('span', { class: 'diff' }, `에러: ${r.error}`));
    for (let i = 0; i < n; i++) {
      const a = orig.out[i], b = masked.out[i];
      const mine = r === orig ? a : b;
      const differ = a !== b;
      if (mine === undefined) { if (differ) out.append(h('span', { class: 'diff none' }, '(없음)'), '\n'); continue; }
      out.append(differ ? h('span', { class: 'diff' }, mine) : mine, '\n');
    }
    if (!r.out.length && !r.kind) out.append(h('span', { class: 'none' }, '(출력 없음)'));
    return h('div', { class: 'box' }, h('span', { class: 'box-t' }, title), out);
  };
  const first = col(masked, `${line + 1}번 줄을 가린 코드 · 정답과 같음`);
  first.classList.add('ans-box');
  const wrap = h('div', { class: 'side' }, h('div', { class: 'pair' }, first, col(orig, '비교: 원래 코드')));
  let differs = false;
  for (let i = 0; i < n; i++) if (orig.out[i] !== masked.out[i]) differs = true;
  if (differs) wrap.append(h('p', { class: 'live' }, '색칠한 줄 = 두 코드에서 다른 줄'));
  if (!orig.live || !masked.live) wrap.append(h('p', { class: 'live' }, '미리 실행한 결과예요'));
  return wrap;
}

// ---------- 한 판 (flows 3장) ----------
function playNext() {
  const ctx = context();
  const plan = planNow(ctx);
  const item = plan.queue[0];
  if (!item) { go('#/'); return; }
  const p = state.byId.get(item.id);
  state.round = {
    item, p, ctx,
    stageIdx: 0,
    rec: ctx.records[p.id] ? structuredClone(ctx.records[p.id]) : null,
    before: ctx.records[p.id] ? structuredClone(ctx.records[p.id]) : null, // 코드 탑 장면: 한 판 전후 비교 (flows 14-2)
    answers: [],      // { status, retry }
    banner: null,
    helpOpen: false, helpTab: 'faq', locked: false,
  };
  renderStage();
}

const glossTerm = (p) => (state.glossary ? p.terms.map((t) => state.glossary.get(t)).find(Boolean) : null);

// 용어 머리: 영어 이름을 크게, 한글 현업 발음과 우리말 이름은 작게(발음 기호는 넣지 않는다)
function termHead(p) {
  const t = glossTerm(p);
  if (!t) return [];
  const pron = t.pronunciation && t.pronunciation.ko;
  const sub = [pron, t.term_ko !== pron ? t.term_ko : null].filter(Boolean).join(' · ');
  return [h('span', { class: 'term', lang: 'en' }, t.term_en), sub ? h('span', { class: 'term-sub' }, sub) : null];
}

// 이 코드 속 용어: 비유 1문장(AC-54)과, 비유의 각 부분이 코드 몇 번 줄인지 잇는다.
// 답하기 전 ② · ③에서는 숨긴다(가린 줄의 답을 알려 주게 되므로, AC-56과 같은 이유).
function inCodeBox(p) {
  const t = glossTerm(p);
  if (!p.in_code) return null;
  return h('div', { class: 'incode' },
    h('p', { class: 'incode-t' }, t ? `이 코드 속 ${t.term_en}` : '이 코드 속 용어'),
    t ? h('p', { class: 'incode-analogy' }, `비유 · ${t.analogy}`) : null,
    h('ul', { class: 'incode-list' }, ...p.in_code.map((it) => h('li', {},
      h('span', { class: 'lnchip' }, `${it.lines.map((l) => l + 1).join(' · ')}번 줄`), h('span', {}, it.text)))));
}

// ---------- 위쪽 단계 탭 (Q36, AC-17d~17f) ----------
// 지금 화면 탭은 꽉 채운 색(aria-current). ①에서 ② 탭 → ②로. 답하기 전 ① 탭은 🔒 잠김(가린 줄이 보이면 답을 알려 주므로).
// 답한 뒤(착각이 아닐 때) ① 탭 = ① 다시 보기, 그때 ② 탭 = 결과로 돌아가기. 착각 다시 풀기 중에는 누르지 못한다.
const goToMaskFromView = () => { const rd = state.round; rd.rec = R.recordView(rd.rec, { day: rd.ctx.day, review: rd.item.kind === 'review' }); rd.traceIdx = undefined; nextStage(); };
const openViewAgain = () => { const rd = state.round; rd.again = true; rd.traceIdx = -1; rd.helpOpen = false; renderStage(); };
const backToResult = () => { const rd = state.round; rd.again = false; rd.traceIdx = undefined; renderStage(); reveal('.res'); };
function stageTab(stage, i) {
  const rd = state.round;
  const cur = rd.again ? rd.item.stages.indexOf(R.STAGE.VIEW) : rd.stageIdx;
  const label = STAGE_KO[stage];
  if (i === cur && !rd.retry) return h('span', { class: 'tab on', 'aria-current': 'step' }, label);
  let action = null;
  let locked = false;
  if (!rd.retry) {
    const curStage = rd.item.stages[rd.stageIdx];
    const answered = rd.quiz && rd.quiz.result;
    if (rd.again && i === rd.stageIdx) action = backToResult;                                         // 다시 보는 중 → 결과로
    else if (curStage === R.STAGE.VIEW && i === rd.stageIdx + 1) action = goToMaskFromView;           // ①에서 다음 단계로 (AC-17d)
    else if (stage === R.STAGE.VIEW && i < rd.stageIdx) {
      if (answered && answered.status !== 'misconception') action = openViewAgain;                     // 답한 뒤 = ① 다시 보기
      else locked = !answered;                                                                          // 답하기 전 🔒 (AC-17e)
    } else if (answered && i === rd.stageIdx + 1 && answered.status !== 'misconception') action = nextStage; // 답한 뒤 다음 단계로
  }
  if (action) return btn(label, action, 'btn ghost small tab');
  const b = btn(locked ? `${label} 🔒 답한 뒤` : label, () => {}, 'btn ghost small tab' + (locked ? ' locked' : ''));
  b.disabled = true;
  if (locked) b.setAttribute('aria-label', `${label}: 답한 뒤에 열려요`);
  return b;
}

function roundFrame(content, footer = null) {
  const rd = state.round;
  const { p, item } = rd;
  const ladder = h('div', { class: 'ladder', role: 'group', 'aria-label': '단계' },
    // 복습처럼 ①이 없는 판에서 ① 다시 보기 중이면, 지금 화면을 따로 표시한다
    rd.again && !item.stages.includes(R.STAGE.VIEW) ? h('span', { class: 'tab on', 'aria-current': 'step' }, '① 다시 보기') : null,
    ...item.stages.map((s, i) => stageTab(s, i)),
    rd.retry ? h('span', { class: 'tab on', 'aria-current': 'step' }, '다시 풀기') : null,
    btn(rd.helpOpen ? '도움 닫기' : '? 궁금해요', () => { rd.helpOpen = !rd.helpOpen; renderStage(); }, 'btn ghost small help-btn'));
  const meta = h('div', { class: 'meta' }, h('span', { class: 'lv' }, G.LEVEL_NAMES[p.level]), ...termHead(p));
  return h('section', { class: 'card' }, meta, rd.locked ? null : inCodeBox(p), ladder, rd.helpOpen ? helpSheet() : null, content, footer);
}

function renderStage() {
  const rd = state.round;
  if (rd.retry) return renderRetry();
  if (rd.again) return renderView(); // 답한 뒤 ① 다시 보기 (AC-17b)
  const stage = rd.item.stages[rd.stageIdx];
  if (stage === R.STAGE.VIEW) return renderView();
  return renderQuiz(stage);
}

function nextStage() {
  const rd = state.round;
  rd.helpOpen = false;
  if (rd.stageIdx + 1 < rd.item.stages.length) { rd.stageIdx += 1; rd.quiz = null; renderStage(); }
  else finishRound();
}

// ① 해석 보기: 비유 1문장 · 이름표 · 다음 줄 실행 (AC-17 · 54 · 55)
function renderView() {
  const rd = state.round;
  const { p } = rd;
  rd.locked = false;
  if (rd.traceIdx === undefined) rd.traceIdx = -1;
  const scene = rd.traceIdx >= 0 ? p.trace[rd.traceIdx] : null;
  const names = p.names || {};
  const vars = scene ? Object.entries(scene.vars).map(([k, v]) => h('div', { class: 'vline' }, `${k} = ${v}`, names[k] ? h('span', { class: 'gloss' }, names[k]) : null)) : [];
  const atEnd = rd.traceIdx >= p.trace.length - 1;
  const firstStep = rd.traceIdx === -1;
  const stepBtn = btn(atEnd ? '처음부터 ↺' : '다음 줄 실행 ▶', () => {
    rd.traceIdx = atEnd ? -1 : rd.traceIdx + 1;
    renderStage();
    // 처음 누를 때만, 휴대폰에서 코드 칸을 화면 맨 위로 올려 코드와 설명 칸이 한 화면에 같이 보이게 한다
    if (firstStep && window.matchMedia('(max-width: 760px)').matches) document.querySelector('.code')?.scrollIntoView({ block: 'start' });
  });
  // ◀ 이전: 바로 전 "장면"으로(윗줄이 아니라 실행 순서대로 한 걸음 뒤). 맨 앞에서는 아무 일도 하지 않는다.
  const prevBtn = btn('◀ 이전', () => { if (rd.traceIdx >= 0) { rd.traceIdx -= 1; renderStage(); } }, 'btn ghost');
  prevBtn.setAttribute('aria-label', '이전 장면 보기');
  prevBtn.disabled = rd.traceIdx < 0; // 맨 앞에서는 되돌릴 장면이 없어 흐리게(누를 수 없음) 보여 준다 (Q35)
  // 단계를 넘기는 버튼은 ①의 맨 끝(설명 · 변수 상자 아래)에 둔다: 다 읽은 뒤 누르는 자리, 자주 누르는 버튼과 떨어뜨려 잘못 누르지 않게
  // ① 다시 보기 중이면: 기록을 바꾸지 않고 결과 화면으로만 돌아간다 (AC-17b · 17c)
  const nextBtn = rd.again
    ? btn('◀ 결과로 돌아가기', backToResult, 'btn ghost next-stage')
    // "다음"은 줄을 넘기는 버튼에만 쓰고, 단계 버튼은 "○○로 넘어가기"로(Q31 A안: 다음 줄을 보려다 단계를 넘기지 않게)
    : btn(rd.item.stages.length > 1 ? `${STAGE_KO[rd.item.stages[rd.stageIdx + 1]]}로 넘어가기` : '다 봤어요 ▶', goToMaskFromView, 'btn ghost next-stage');
  show(roundFrame(h('div', { class: 'cols' },
    h('div', { class: 'side' }, codeView(p, { cur: scene ? scene.line : null, labels: true, keys: true })),
    h('div', { class: 'side' },
      // 지금 줄과 같은 색 바탕: 코드의 그 줄과 설명을 눈이 바로 잇게
      h('div', { class: scene ? 'box now' : 'box' }, h('span', { class: 'box-t' }, '지금 줄이 하는 일'),
        ...(scene ? lineReading(p, scene) : [h('p', {}, '[다음 줄 실행]을 눌러 보세요.')])),
      h('div', { class: 'pair' },
        h('div', { class: 'box' }, h('span', { class: 'box-t' }, '변수 상자'), h('div', { class: 'var' }, ...vars)),
        h('div', { class: 'box' }, h('span', { class: 'box-t' }, '출력'), h('div', { class: 'out' }, scene ? scene.out.join('\n') : ''))),
      nextBtn)),
    // 아래 고정 버튼 줄: 화면을 내려도 따라오고, 엄지가 잘 닿는 곳(화면 아래)
    h('div', { class: 'stepbar' }, prevBtn, stepBtn)));
}

const piecesView = (list) => h('div', { class: 'pieces' }, ...list.map(([c, mean]) => h('span', { class: 'piece' }, h('code', {}, c), h('span', {}, mean))));

// 지금 줄 읽기: 조각마다 뜻(조각 풀이) → 이어 읽기 → 지금 값으로 일어난 일
function lineReading(p, scene) {
  const pieces = (p.pieces && p.pieces[scene.line]) || [];
  return [
    h('p', { class: 'line-code' }, `${scene.line + 1}번 줄 `, h('code', {}, p.code[scene.line].trim())),
    pieces.length ? piecesView(pieces) : null,
    h('p', { class: 'read' }, codeText(p.explain[scene.line])),
    h('p', { class: 'muted' }, codeText(scene.note)),
  ];
}

// ② 가려 보기 · ③ 해석 고르기 (flows 3-1)
function renderQuiz(stage) {
  const rd = state.round;
  const { p, item } = rd;
  const m = p.masks[item.mask];
  const isMask = stage === R.STAGE.MASK;
  const quizData = isMask ? m.predict : m.interpret;
  if (!rd.quiz) rd.quiz = { conf: null, picked: null, options: shuffle(quizData.options), result: null, ran: null };
  const qz = rd.quiz;
  rd.locked = !qz.result;

  const question = isMask ? `${m.line + 1}번 줄을 가리고 실행하면 무엇이 출력될까요?` : `${m.line + 1}번 줄은 무슨 일을 하나요?`;
  const right = h('div', { class: 'side' }, h('p', { class: 'q' }, question),
    isMask ? null : h('p', { class: 'qcode' }, h('code', {}, p.code[m.line].trim())));

  // 확신도 3개 (AC-18). 답을 내기 전까지는 다시 고를 수 있다 (AC-18a, Q42)
  const answered = !!qz.result || !!qz.busy;
  const confRow = h('div', { class: 'conf', role: 'group', 'aria-label': '확신도' },
    ...CONF.map(([k, label]) => h('button', {
      type: 'button', class: 'btn' + (qz.conf === k ? '' : ' ghost'), disabled: answered, 'aria-pressed': qz.conf === k ? 'true' : 'false',
      onclick: () => {
        const first = !qz.conf;
        qz.conf = k;
        if (k === 'dontknow') { qz.picked = null; answer(stage, null); } // 몰라요: 보기 없이 정답 + 풀이 (AC-22)
        else { renderStage(); if (first) reveal('.opts'); }
      },
    }, label)));
  right.append(confRow);

  if (qz.conf && qz.conf !== 'dontknow') {
    const opts = h('div', { class: 'opts' });
    for (const o of qz.options) {
      const cls = ['opt'];
      if (qz.picked === o) cls.push('pick');
      if (qz.result && o.correct) cls.push('ans');
      const badge = optBadge(o, qz.picked, !!qz.result);
      // ②는 실행 전까지 보기를 바꿀 수 있다 (AC-18b). ③은 보기를 누르면 바로 답이다
      opts.append(h('button', { type: 'button', class: cls.join(' '), 'aria-label': optLabel(o) + (badge ? ` (${badge.textContent})` : ''), 'aria-pressed': isMask && !answered ? String(qz.picked === o) : null, disabled: isMask ? answered : !!qz.picked, onclick: () => { qz.picked = o; if (isMask) renderStage(); else answer(stage, o); } }, withBadge(optionBody(o, isMask), badge)));
    }
    right.append(opts);
    if (isMask && qz.picked && !qz.result) {
      const runBtn = btn(qz.busy ? '실행하는 중…' : '실행해서 확인하기 ▶', () => answer(stage, qz.picked));
      runBtn.disabled = !!qz.busy;
      right.append(h('div', { class: 'row' }, runBtn));
    }
  }

  if (qz.result) {
    if (qz.ran) right.append(compareView(qz.ran.orig, qz.ran.masked, m.line));
    right.append(resultView(qz.result, quizData));
  }
  const code = isMask ? codeView(p, { maskLine: qz.ran ? null : m.line, cur: qz.ran ? m.line : null, keys: !rd.locked }) : codeView(p, { cur: m.line, keys: !rd.locked });
  show(roundFrame(h('div', { class: 'cols' }, h('div', { class: 'side' }, code), right)));
}

async function answer(stage, picked) {
  const rd = state.round;
  const { p, item } = rd;
  const m = p.masks[item.mask];
  const qz = rd.quiz;
  if (qz.result || qz.busy) return; // 한 번만 답한다 (확신도 · 보기를 바꿀 수 있어도 답은 1번)
  const correct = qz.conf === 'dontknow' ? false : !!(picked && picked.correct);
  if (stage === R.STAGE.MASK) {
    qz.busy = true; // 실행을 기다리는 동안 확신도 · 보기를 잠근다
    renderStage();
    const [orig, masked] = await Promise.all([run(p.code, p.outputs.original), run(maskedLines(p.code, m.line), m.output)]);
    qz.ran = { orig, masked };
    qz.busy = false;
  }
  const res = R.recordAnswer(rd.rec, { day: rd.ctx.day, step: stage, mask: item.mask, line: m.line, confidence: qz.conf, correct, allOptions: true, review: item.kind === 'review' });
  rd.rec = res.record;
  rd.answers.push({ status: res.status });
  // 응원 1줄은 답할 때 한 번 고른다 (AC-13f~13h). 다시 그려도 바뀌지 않게 결과에 붙여 둔다
  const cheer = T.pickEncourage(res.status, state.lastEncourage);
  if (cheer) state.lastEncourage = cheer;
  qz.result = { status: res.status, picked, conf: qz.conf, cheer };
  renderStage();
  reveal('.res');
}

function answerLine(o, label = '정답') {
  if (Array.isArray(o.out)) return h('div', { class: 'answer' }, h('span', {}, label), outLines(o.out));
  return h('div', { class: 'answer' }, h('span', {}, '정답'), o.code ? h('code', { class: 'opt-code' }, o.code) : null, h('span', {}, codeText(o.text)));
}

// 자세한 해설 (AC-13a): 정답 이유(모름일 때는 위에 이미 있어 뺀다) · 그 줄 조각 풀이 · 그 줄 우리말 풀이
// [자세히 보기] 버튼: ②면 가린 코드 따라가기 표를 먼저 만든다 (AC-13b · 13c)
function detailBtn(isMask, maskLine) {
  const rd = state.round;
  return btn('자세히 보기', async () => {
    if (isMask) rd.quiz.follow = await makeFollow(rd.p, maskLine);
    rd.quiz.detail = true; renderStage(); reveal('.detail');
  }, 'btn ghost');
}

// 푸는 요령 한 줄 (AC-13e): 가린 줄의 = 왼쪽(또는 push · pop 같은 목록 바꾸기)을 읽어 어느 상자가 바뀌는지 알려 준다.
function maskTip(p, line) {
  const t = p.code[line].trim();
  const n = line + 1;
  // = · += 같은 넣기, 그리고 x++ · ++x · x-- (값을 바꾸는 상자 이름을 읽는다)
  let m = t.match(/^(?:let|const|var)?\s*([A-Za-z_$][\w$]*)\s*(?:\*\*|\?\?|\|\||&&|[-+*/%])?=(?!=)/)
    || t.match(/^([A-Za-z_$][\w$]*)\s*(?:\+\+|--)/) || t.match(/^(?:\+\+|--)\s*([A-Za-z_$][\w$]*)/);
  // 이미 있는 이름에 새 객체 · 목록을 넣는 줄(staging = { ...production }): 없으면 앞에서 가리키던 객체를 계속 함께 쓴다
  if (m && !/^(?:let|const|var)\b/.test(t) && /=\s*[{[]/.test(t)) return h('p', { class: 'tip' }, `요령 · 가린 ${n}번 줄은 `, h('code', {}, m[1]), '에 새 객체를 넣는 줄이에요. 이 줄이 없으면 앞에서 가리키던 객체를 그대로 가리켜서, 뒤에서 칸을 바꾸면 그 객체를 함께 가리키는 다른 이름도 같이 바뀌어요. 표에서 확인해 보세요.');
  if (m) return h('p', { class: 'tip' }, `요령 · 가린 ${n}번 줄은 `, h('code', {}, m[1]), '만 바꿔요. 다른 상자는 남은 줄만 따라가면 돼요.');
  // 객체 칸 넣기 (staging.debug = true): 같은 객체를 가리키는 다른 이름도 함께 바뀐다
  m = t.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*(?:\*\*|\?\?|\|\||&&|[-+*/%])?=(?!=)/);
  if (m) return h('p', { class: 'tip' }, `요령 · 가린 ${n}번 줄은 `, h('code', {}, m[1]), '만 바꿔요. 같은 객체를 가리키는 다른 이름이 있으면 그쪽도 함께 바뀌어요.');
  m = t.match(/^([A-Za-z_$][\w$]*)\.(push|pop|shift|unshift|splice|sort|reverse|fill)\(/);
  if (m) return h('p', { class: 'tip' }, `요령 · 가린 ${n}번 줄은 목록 `, h('code', {}, m[1]), '만 바꿔요. 다른 상자는 남은 줄만 따라가면 돼요.');
  if (/^console\.log\(/.test(t)) return h('p', { class: 'tip' }, `요령 · 가린 ${n}번 줄은 보여 주기만 해서 상자 값은 그대로예요. 그 줄의 출력만 빠져요.`);
  return h('p', { class: 'tip' }, `요령 · 가린 ${n}번 줄은 흐름(조건 · 되풀이 · 부르기)을 정하는 줄이에요. 표에서 어느 줄을 건너뛰는지 보세요.`);
}

function detailView(p, line, correctOpt, withWhy, follow = null, isMask = false) {
  return h('div', { class: 'detail' },
    isMask ? maskTip(p, line) : null,
    withWhy ? h('p', {}, h('b', {}, '정답인 이유 '), codeText(correctOpt.why)) : null,
    follow ? followView(p, line, follow) : null,
    h('p', { class: 'line-code' }, isMask ? `가린 줄(${line + 1}번 줄) ` : `${line + 1}번 줄 `, h('code', {}, p.code[line].trim())),
    p.pieces && p.pieces[line] ? piecesView(p.pieces[line]) : null,
    h('p', { class: 'read' }, codeText(p.explain[line])));
}

// 가린 코드 따라가기 (AC-13b · 13c): 실행기가 줄마다 남긴 상자 값으로 표를 만든다. 바뀐 값은 굵게.
const followNames = (p) => [...new Set([...Object.keys(p.names || {}), ...p.trace.flatMap((s) => Object.keys(s.vars))])];
async function makeFollow(p, line) {
  const masked = maskedLines(p.code, line);
  if (isAsync(masked)) { const r = await run(masked, null); return { async: true, out: r.out || [] }; }
  const r = await run(tracedLines(p.code, line, followNames(p)), null);
  return r.kind ? null : { async: false, rows: r.trace || [] };
}
function followView(p, line, follow) {
  if (follow.async) {
    return h('div', { class: 'follow' }, h('p', {}, h('b', {}, `${line + 1}번 줄을 가린 코드의 실제 출력 순서`)),
      h('ol', { class: 'follow-out' }, ...(follow.out.length ? follow.out.map((o) => h('li', {}, h('code', {}, o))) : [h('li', {}, '(출력 없음)')])),
      h('p', { class: 'live' }, '기다리는(await) 코드는 줄 순서와 실행 순서가 달라서, 나온 순서대로 보여 줘요.'));
  }
  const names = followNames(p).filter((n) => follow.rows.some((r) => n in r.vars));
  const head = h('tr', {}, h('th', {}, '줄'), h('th', {}, '코드'), ...names.map((n) => h('th', {}, h('code', {}, n))), h('th', {}, '새 출력'));
  let prev = {};
  let prevOut = 0;
  // 가린 줄 표시: 가린 줄 바로 앞의 실행 줄을 처음 실제로 지나간 직후 한 번만(그 자리에 왔을 때만) 넣는다.
  // 조건이 거짓이라 그 자리에 오지 않았으면 표시하지 않는다.
  let before = -1;
  for (let i = line - 1; i >= 0; i--) { const t = p.code[i].trim(); if (t.endsWith('{') || t.endsWith(';')) { before = i; break; } }
  let gapShown = false;
  const gapRow = () => h('tr', { class: 'gap' }, h('td', {}, String(line + 1)), h('td', { colspan: String(names.length + 2) }, `${p.code[line].trim()}  ← 가린 줄이라 실행하지 않아요`));
  const body = follow.rows.flatMap((r, k) => {
    const lead = !gapShown && before === -1 && k === 0 ? [gapRow()] : [];
    const row = rowOf(r);
    const tail = !gapShown && before !== -1 && r.line === before ? [gapRow()] : [];
    if (lead.length || tail.length) gapShown = true;
    return [...lead, row, ...tail];
  });
  function rowOf(r) {
    const cells = names.map((n) => {
      const v = r.vars[n];
      const changed = v !== undefined && v !== prev[n];
      return h('td', { class: changed ? 'chg' : '' }, v === undefined ? '' : v);
    });
    const added = r.out.slice(prevOut);
    prev = r.vars;
    prevOut = r.out.length;
    return h('tr', {}, h('td', {}, String(r.line + 1)), h('td', {}, h('code', {}, p.code[r.line].trim())), ...cells, h('td', {}, added.join(' / ')));
  }
  return h('div', { class: 'follow' }, h('p', {}, h('b', {}, `${line + 1}번 줄을 뺀 코드를 실제로 한 줄씩 실행하면`)),
    h('div', { class: 'follow-wrap' }, h('table', { class: 'follow-table' }, h('thead', {}, head), h('tbody', {}, ...body))),
    h('p', { class: 'live' }, '굵은 값 = 그 줄에서 바뀐 값'));
}

function resultView(result, quizData) {
  const rd = state.round;
  const correctOpt = quizData.options.find((o) => o.correct);
  const maskLine = rd.p.masks[rd.item.mask].line;
  const isMask = quizData === rd.p.masks[rd.item.mask].predict;
  const ansLabel = isMask ? `정답 · ${maskLine + 1}번 줄을 가린 코드의 출력` : '정답';
  const good = result.status === 'known' || result.status === 'shaky';
  const box = h('div', { class: 'res ' + (good ? 'good' : 'warm') }, h('p', { class: 'stat' }, STATUS_KO[result.status]),
    result.cheer ? h('p', { class: 'cheer-line' }, result.cheer) : null); // 응원 1줄 (AC-13f)
  if (result.conf === 'dontknow') {
    box.append(answerLine(correctOpt, ansLabel), h('p', { class: 'why' }, codeText(correctOpt.why)));
  } else if (result.picked && !result.picked.correct) {
    box.append(h('p', { class: 'why' }, codeText(result.picked.why)), answerLine(correctOpt, ansLabel)); // 고른 보기의 착각 풀이 (AC-13)
  } else if (result.picked) {
    box.append(h('p', { class: 'why' }, codeText(result.picked.why)));
  }
  // 자세히 보기 (AC-13a): 착각이 아닌 틀린 결과(헷갈림 · 모름)에서만. 이미 있는 데이터(정답 이유 · 조각 풀이 · 우리말 풀이)를 펼친다.
  // 처음엔 접어 두고 버튼 하나 뒤에 둔다(Q18). 답한 뒤라 가린 줄을 보여 줘도 된다.
  // 모든 결과(맞힘 · 틀림 · 착각)에 자세히 보기 (Q38). 정답 이유가 위에 이미 있으면(모름 · 맞힘) 다시 보여 주지 않는다.
  const canDetail = true;
  const whyShown = result.conf === 'dontknow' || (result.picked && result.picked.correct);
  if (canDetail && rd.quiz.detail) box.append(detailView(rd.p, maskLine, correctOpt, !whyShown, isMask ? rd.quiz.follow : null, isMask));
  const row = h('div', { class: 'row' });
  if (result.status === 'misconception') {
    // 그날 같은 줄을 맞힐 때까지 다시 (AC-25~28)
    row.append(btn('그 줄 풀이 보기 ▶', () => startRetry(result.picked)), btn('나중에 다시', postponeRound, 'btn ghost'));
    if (!rd.quiz.detail) row.append(detailBtn(isMask, maskLine));
  } else {
    if (canDetail && !rd.quiz.detail) row.append(detailBtn(isMask, maskLine));
    row.append(btn(rd.stageIdx + 1 < rd.item.stages.length ? `다음: ${STAGE_KO[rd.item.stages[rd.stageIdx + 1]]} ▶` : '다음 ▶', nextStage),
      // 답한 뒤에만 ①을 다시 본다. 답하기 전에는 가린 줄을 알려 주게 되므로 두지 않는다 (AC-17a)
      btn('① 다시 보기', openViewAgain, 'btn ghost'));
  }
  box.append(row);
  return box;
}

// ---------- 착각 다시 풀기 (flows 5-1) ----------
function startRetry(firstPicked) {
  const rd = state.round;
  const { p, item } = rd;
  const maskIdx = p.masks.findIndex((mm) => mm.line === rd.rec.mis.line);
  const m = p.masks[maskIdx >= 0 ? maskIdx : item.mask];
  // 처음 답이 ② 보기였으면 그 보기를 뺀다(AC-27). ③에서 착각했으면 ② 보기는 4개 그대로 시작한다.
  const firstWasPredict = firstPicked && m.predict.options.includes(firstPicked);
  rd.retry = { m, maskIdx: maskIdx >= 0 ? maskIdx : item.mask, phase: 'explain', picked: firstWasPredict ? [firstPicked.text] : [], last: null, ran: null };
  rd.helpOpen = false;
  renderStage();
}

function renderRetry() {
  const rd = state.round;
  const { p } = rd;
  const rt = rd.retry;
  const { m } = rt;
  const later = btn('나중에 다시', postponeRound, 'btn ghost');
  if (rt.phase === 'explain') {
    // 그 줄의 ① 해석 보기를 먼저 1번 (AC-26)
    rd.locked = false;
    const scenes = p.trace.filter((s) => s.line === m.line);
    show(roundFrame(h('div', { class: 'cols' },
      h('div', { class: 'side' }, codeView(p, { cur: m.line, keys: true })),
      h('div', { class: 'side' },
        h('div', { class: 'box line-note' }, h('span', { class: 'box-t' }, `${m.line + 1}번 줄`),
          p.pieces && p.pieces[m.line] ? piecesView(p.pieces[m.line]) : null,
          h('p', { class: 'read' }, codeText(p.explain[m.line])), ...scenes.map((s) => h('p', { class: 'muted' }, codeText(s.note)))),
        h('div', { class: 'row' }, btn('다시 풀어 보기 ▶', () => { rt.phase = 'ask'; renderStage(); }), later)))));
    return;
  }
  rd.locked = !rt.done;
  const options = R.remainingOptions(m.predict.options, rt.picked);
  const right = h('div', { class: 'side' }, h('p', { class: 'q' }, `${m.line + 1}번 줄을 가리고 실행하면 무엇이 출력될까요?`));
  const opts = h('div', { class: 'opts' });
  for (const o of options) {
    const cls = ['opt'];
    if (rt.done && o.correct) cls.push('ans');
    const badge = optBadge(o, rt.done, !!rt.done);
    opts.append(h('button', { type: 'button', class: cls.join(' '), 'aria-label': optLabel(o) + (badge ? ` (${badge.textContent})` : ''), disabled: !!rt.done, onclick: () => retryAnswer(o, options.length) }, withBadge(optionBody(o, true), badge)));
  }
  right.append(opts);
  if (rt.last && !rt.done) right.append(h('div', { class: 'res warm' }, h('p', { class: 'why' }, codeText(rt.last.why))));
  if (rt.done) {
    if (rt.ran) right.append(compareView(rt.ran.orig, rt.ran.masked, m.line));
    right.append(h('div', { class: 'res good' }, h('p', { class: 'stat' }, '맞혔어요'), h('p', { class: 'why' }, codeText(rt.done.why)),
      h('div', { class: 'row' }, btn('다음 ▶', () => { rd.retry = null; nextStage(); }))));
  } else {
    right.append(h('div', { class: 'row' }, later));
  }
  show(roundFrame(h('div', { class: 'cols' }, h('div', { class: 'side' }, codeView(p, { maskLine: rt.done ? null : m.line, cur: rt.done ? m.line : null, keys: !rd.locked })), right)));
}

async function retryAnswer(o, shown) {
  const rd = state.round;
  const rt = rd.retry;
  const res = R.recordAnswer(rd.rec, { day: rd.ctx.day, step: R.STAGE.MASK, mask: rt.maskIdx, line: rt.m.line, confidence: 'sure', correct: !!o.correct, allOptions: shown === R.OPTIONS, retry: true, review: rd.item.kind === 'review' });
  rd.rec = res.record;
  rd.answers.push({ status: res.status, retry: true });
  if (o.correct) {
    const p = rd.p;
    const [orig, masked] = await Promise.all([run(p.code, p.outputs.original), run(maskedLines(p.code, rt.m.line), rt.m.output)]);
    rt.ran = { orig, masked };
    rt.done = o;
  } else {
    rt.picked = [...rt.picked, o.text]; // 틀린 보기는 다음 시도에서 뺀다 (AC-27)
    rt.last = o;
  }
  renderStage();
  reveal('.res');
}

function postponeRound() {
  const rd = state.round;
  rd.rec = R.postpone(rd.rec, { day: rd.ctx.day }); // 다음 날 복습 1순위 (AC-28)
  rd.retry = null;
  finishRound();
}

// ---------- 한 판 끝: 저장 · 오늘 기록 · 등급 (flows 6장) ----------
function finishRound() {
  const rd = state.round;
  const { p, item, ctx } = rd;
  const stepsDone = rd.stageIdx + 1;
  S.setProblem(p.id, rd.rec);
  const t = S.getToday(ctx.day);
  const stepsAfter = t.steps_done + stepsDone;
  S.setToday({ ...t, steps_done: stepsAfter, new_steps_done: t.new_steps_done + (item.kind === 'new' ? stepsDone : 0), seen: [...t.seen, p.id] });
  let log = S.read('log', {});
  for (const a of rd.answers) log = G.logAnswer(log, { day: ctx.day, status: a.status, retry: !!a.retry });
  S.write('log', log);

  const records = S.allRecords(state.problems);
  const { grade, banner } = G.updateGrade(S.read('grade', null), state.problems, records, { startLevel: startLevel(ctx) });
  S.write('grade', grade);
  updateTodayBar();

  // 코드 탑 (flows 14장): 장식 갱신 → 장면 1개 고르기 → 응원 1줄
  const goalMet = t.steps_done < P.DAILY_GOAL && stepsAfter >= P.DAILY_GOAL;   // 하루 목표를 처음 채움 (AC-44i)
  const upd = T.updateTower(S.read('tower', null), state.problems, records, { day: ctx.day, goalMet });
  S.write('tower', upd.tower);
  const scene = T.sceneFor(rd.before, rd.rec);
  const tiers = T.towerTiers(state.problems, records);
  const tier = tiers.find((x) => x.level === p.level);
  const filled = tier ? tier.cells.filter((c) => c.shape !== 'empty').length : 0;
  const cheer = T.cheerFor(scene, { tierName: tier && tier.name, filled, total: tier ? tier.cells.length : 0, nextDays: T.daysUntil(ctx.day, rd.rec) });
  const big = T.hasBigScene(upd.added);   // 큰 장면 (AC-44h)

  const firsts = rd.answers.filter((a) => !a.retry);
  const plan = planNow();
  const card = h('section', { class: 'card round-end' }, h('h2', {}, '한 판 끝'),
    ...firsts.map((a) => h('p', { class: 'meaning' }, h('b', {}, STATUS_KO[a.status]), ` — ${T.meaningFor(a.status, T.daysUntil(ctx.day, rd.rec))}`)),   // 결과 뜻 + 다시 나오는 날 (AC-44a · 44u)
    h('div', { class: 'tw-scene' }, towerSvg(tiers, upd.tower, { day: ctx.day, mark: { id: p.id, kind: scene.kind }, big })),  // 작은 · 큰 장면 (AC-44g · 44h)
    h('p', { class: 'cheer' }, cheer.cheer),                                                                                    // 응원 (AC-44b)
    cheer.sub ? h('p', { class: 'muted small' }, cheer.sub) : null,
    big ? h('div', { class: 'banner tw-big-lines' }, ...T.bigLines(upd.added, upd.tower).map((l) => h('b', {}, l))) : null);
  if (banner) card.append(bannerView(banner)); // 승급 · 이정표는 자체 배너 1개 (AC-44, 광고 없음 AC-45)
  card.append(h('div', { class: 'row' },
    plan.queue.length ? btn('다음 문제 ▶', () => playNext()) : null,
    btn('처음으로', () => go('#/'), plan.queue.length ? 'btn ghost' : 'btn')));
  state.round = null;
  show(card);
}

function bannerView(b) {
  if (b.type === 'promote') {
    return h('div', { class: 'banner' }, h('b', {}, `🎉 ${b.name} 등급으로 올랐어요`),
      b.misconceptions ? h('span', {}, `🚨 확인할 착각 ${b.misconceptions}개`) : null); // AC-42
  }
  return h('div', { class: 'banner' }, h('b', {}, `★ ${b.name} ${b.learned}개 익힘`));
}

// ---------- 코드 탑: 삼층석탑 그리기 (flows 14장, ADR-0006, 시안 docs/mockups/stone-tower.html) ----------
// 규칙(칸 모양 · 장면 · 장식)은 tower.js에 있고, 여기는 SVG로 그리기만 한다. 외부 이미지 0개.
const SVG_NS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}
let svgSeq = 0;
// 불국사 삼층석탑 비례: 위 기단(입문)은 높고 넓게, 1층 몸돌은 높고 좁게, 2 · 3층은 낮게. 층마다 층급받침 3단 + 지붕돌
const TOWER_PARTS = [
  { w: 196, h: 76, cap: { w: 216, h: 9 } },
  { w: 92, h: 82, roof: { steps: [104, 116, 128], bw: 200, tw: 62, h: 15 } },
  { w: 80, h: 32, roof: { steps: [92, 102, 112], bw: 176, tw: 54, h: 13 } },
  { w: 70, h: 28, roof: { steps: [82, 90, 98], bw: 154, tw: 46, h: 12 } },
];
const towerCols = (level, n) => (level === 2 ? (n <= 6 ? 3 : 4) : 6);
const SCENE_CLASS = { place: 'tw-drop', 'place-crack': 'tw-drop', crack: 'tw-shake', drop: 'tw-shake', repair: 'tw-glow', harden: 'tw-glow', gild: 'tw-glow', half: 'tw-glow', shine: 'tw-glow' };
function problemLabel(id) {
  const p = state.byId.get(id);
  const t = p && glossTerm(p);
  return t ? `${t.term_ko} 문제` : id;
}
function lanternSvg(lit, extra = {}) {
  const g = sv('g', { class: lit ? 'tw-lantern lit' : 'tw-lantern', ...extra });
  g.append(sv('rect', { x: 2, y: 0, width: 12, height: 3, class: 'cap' }), sv('rect', { x: 1, y: 3, width: 14, height: 9, rx: 2, class: 'blue' }),
    sv('rect', { x: 1, y: 12, width: 14, height: 9, rx: 2, class: 'red' }), sv('rect', { x: 2, y: 21, width: 12, height: 3, class: 'cap' }));
  if (lit) g.append(sv('ellipse', { cx: 8, cy: 12, rx: 4, ry: 6, class: 'light' }));
  return g;
}
// tiers: tower.js towerTiers 결과, tower: 장식. mark: { id, kind } 한 판 끝 장면, big: 큰 장면(AC-44h), onPick: 칸을 누르면(내 탑)
function towerSvg(tiers, tower, { day, mark = null, big = false, onPick = null, cls = '' } = {}) {
  const id = `tw${++svgSeq}`;
  const svg = sv('svg', { viewBox: '0 0 320 450', class: `tower ${cls}${big ? ' tw-big' : ''}`, role: onPick ? 'group' : 'img', 'aria-label': '내 석탑' });
  svg.append(sv('defs', {},
    sv('linearGradient', { id: `${id}-gilt`, x1: 0, y1: 0, x2: 0, y2: 1 }, sv('stop', { offset: '0', 'stop-color': '#fff3b8' }), sv('stop', { offset: '.45', 'stop-color': '#f7d257' }), sv('stop', { offset: '1', 'stop-color': '#e0ac24' })),
    sv('pattern', { id: `${id}-hatch`, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, sv('rect', { width: 5, height: 5, class: 'tw-rough-bg' }), sv('line', { x1: 0, y1: 0, x2: 0, y2: 5, class: 'tw-hatch' }))));
  const gilt = `url(#${id}-gilt)`;
  const slab = (cx, y, w, hh, solid, c = '') => svg.append(sv('rect', { x: cx - w / 2, y, width: w, height: hh, class: `${solid ? 'tw-solid' : 'tw-ghost'} ${c}` }));
  const bell = (x, y) => svg.append(sv('g', { class: 'tw-bell' }, sv('line', { x1: x, y1: y, x2: x, y2: y + 7 }), sv('path', { d: `M${x - 3.5} ${y + 15} Q${x} ${y + 4} ${x + 3.5} ${y + 15} Z` }), sv('rect', { x: x - 1.5, y: y + 16, width: 3, height: 5 })));
  const cx = 160;
  let y = 438;
  svg.append(sv('rect', { x: 14, y, width: 292, height: 6, rx: 2, class: 'tw-ground' }));
  y -= 28; slab(cx, y, 252, 28, true, 'soft');
  y -= 5; slab(cx, y, 262, 5, true);
  tiers.forEach((tier, t) => {
    const part = TOWER_PARTS[t];
    const n = tier.cells.length;
    if (t > 0) slab(cx, y - 4, part.w + 12, 4, true, 'soft');
    const top = y - part.h - (t > 0 ? 4 : 0);
    if (!n) slab(cx, top, part.w, part.h, false);
    const cols = towerCols(tier.level, n), rows = Math.max(1, Math.ceil(n / cols));
    const cw = part.w / cols, ch = part.h / rows;
    tier.cells.forEach((cell, i) => {
      const x = cx - part.w / 2 + (i % cols) * cw, yy = top + Math.floor(i / cols) * ch;
      const shapeName = T.SHAPE_NAMES[cell.shape] + (cell.half ? ' (보수 1/2)' : '');
      const label = `${tier.name} ${i + 1}번 칸: ${problemLabel(cell.id)}, ${shapeName}`;
      const anim = mark && mark.id === cell.id ? SCENE_CLASS[mark.kind] : '';
      const g = sv('g', { class: `tw-cell ${anim}`, 'aria-label': onPick ? label : null, tabindex: onPick ? 0 : null, role: onPick ? 'button' : null });
      const r = { x: x + 0.6, y: yy + 0.6, width: cw - 1.2, height: ch - 1.2, rx: 1.5 };
      if (cell.shape === 'empty') g.append(sv('rect', { ...r, class: 'tw-empty' }));
      else if (cell.shape === 'rough') g.append(sv('rect', { ...r, fill: `url(#${id}-hatch)`, class: 'tw-rough' }));
      else if (cell.shape === 'gilt') g.append(sv('rect', { ...r, fill: gilt, class: 'tw-gilt' }));
      else {
        g.append(sv('rect', { ...r, class: 'tw-solid' }));
        if (cell.shape === 'cracked') g.append(sv('path', { d: `M${x + cw * 0.3} ${yy + 1} l${cw * 0.15} ${ch * 0.35} l${-cw * 0.12} ${ch * 0.2} l${cw * 0.2} ${ch * 0.44}`, class: 'tw-crack' }));
        if (cell.half) g.append(sv('text', { x: x + cw - 2, y: yy + ch - 3, 'text-anchor': 'end', 'font-size': Math.min(9, ch * 0.45), class: 'tw-half' }, '1/2'));
      }
      if (onPick) {
        const pick = () => onPick(g, `${tier.name} · ${problemLabel(cell.id)} — ${shapeName}. ${T.SHAPE_NOTES[cell.shape]}`);
        g.addEventListener('click', pick);
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      }
      svg.append(g);
    });
    y = top;
    const capped = !!tower.caps[tier.level];
    let corners;
    if (t === 0) {
      y -= part.cap.h; slab(cx, y, part.cap.w, part.cap.h, capped);       // 기단 갑석 (AC-44k)
      corners = [cx - part.cap.w / 2 + 2, cx + part.cap.w / 2 - 2, y + part.cap.h];
    } else {
      for (const w of part.roof.steps) { y -= 3; slab(cx, y, w, 3, capped); }   // 층급받침
      const { bw, tw, h: rh } = part.roof;
      const L = cx - bw / 2, R = cx + bw / 2;
      svg.append(sv('path', { d: `M${L} ${y - 5} L${L + 14} ${y} L${R - 14} ${y} L${R} ${y - 5} L${R - 6} ${y - 7} L${cx + tw / 2} ${y - rh} L${cx - tw / 2} ${y - rh} L${L + 6} ${y - 7} Z`, class: capped ? 'tw-solid' : 'tw-ghost' }));  // 지붕돌
      corners = [L + 1, R - 1, y - 5];
      y -= rh;
    }
    const bells = tower.bells[tier.level] || 0;                              // 풍경 (AC-44j)
    if (bells >= 1) bell(corners[0], corners[2]);
    if (bells >= 2) bell(corners[1], corners[2]);
  });
  // 상륜부 (AC-44t): 완성하면 금색으로 올린다. 아직이면 점선 윤곽
  const done = !!tower.done_at;
  const fin = (el) => { el.setAttribute('class', done ? 'tw-gilt' : 'tw-ghost'); if (done) el.setAttribute('fill', gilt); svg.append(el); };
  y -= 4; fin(sv('rect', { x: cx - 20, y, width: 40, height: 4 }));
  y -= 9; fin(sv('rect', { x: cx - 12, y, width: 24, height: 9 }));
  y -= 8; fin(sv('path', { d: `M${cx - 12} ${y + 8} Q${cx} ${y - 6} ${cx + 12} ${y + 8} Z` }));
  y -= 6; fin(sv('path', { d: `M${cx - 11} ${y} L${cx + 11} ${y} L${cx + 7} ${y + 6} L${cx - 7} ${y + 6} Z` }));
  const ringTop = y - 36;
  fin(sv('rect', { x: cx - 1.6, y: ringTop - 22, width: 3.2, height: 58 }));
  for (let k = 0; k < 5; k++) fin(sv('ellipse', { cx, cy: y - 4 - k * 7, rx: 10 - k * 0.9, ry: 2.6 }));
  fin(sv('path', { d: `M${cx - 8} ${ringTop - 2} L${cx + 8} ${ringTop - 2} L${cx + 4} ${ringTop - 7} L${cx - 4} ${ringTop - 7} Z` }));
  fin(sv('circle', { cx, cy: ringTop - 15, r: 4.5 }));
  if (done) svg.append(sv('text', { x: cx + 16, y: ringTop - 10, class: 'tw-done' }, `완성 ${tower.done_at}`));
  // 오늘 켠 청사초롱 (AC-44i)
  if (day && tower.lantern_days.includes(day)) svg.append(lanternSvg(true, { transform: 'translate(266 352) scale(1.6)', class: big ? 'tw-lantern lit tw-lit' : 'tw-lantern lit' }));
  return svg;
}

// 처음 화면 작은 탑 (AC-44m · 44n): 높이 고정, 누르면 내 탑
function towerCard(ctx) {
  const tiers = T.towerTiers(state.problems, ctx.records);
  const tower = T.sanitizeTower(S.read('tower', null));
  const c = T.shapeCounts(tiers);
  const sum = Object.entries(c).filter(([, n]) => n).map(([k, n]) => `${T.SHAPE_NAMES[k]} ${n}`).join(' · ') + (tower.lantern_count ? ` · 청사초롱 ${tower.lantern_count}개` : '');
  const open = () => go('#/tower');
  return h('section', { class: 'card tower-mini', role: 'button', tabindex: 0, 'aria-label': '내 석탑 크게 보기', onclick: open, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
    towerSvg(tiers, tower, { day: ctx.day, cls: 'mini' }),
    h('div', {}, h('b', {}, '내 석탑'), h('p', { class: 'muted small' }, sum), h('span', { class: 'more' }, '크게 보기 ▶')));
}

// 내 탑 (AC-44n~44p): 큰 탑 · 칸 누르면 이름 · 범례 · 장식 1줄 · 청사초롱 28일 줄
function towerScreen() {
  const ctx = context();
  const tiers = T.towerTiers(state.problems, ctx.records);
  const tower = T.sanitizeTower(S.read('tower', null));
  const c = T.shapeCounts(tiers);
  const picked = h('p', { class: 'tw-picked', 'aria-live': 'polite' }, '칸을 누르면 그 문제와 돌 이름이 나와요.');
  const svg = towerSvg(tiers, tower, { day: ctx.day, cls: 'big', onPick: (g, text) => {
    svg.querySelectorAll('.tw-cell.sel').forEach((x) => x.classList.remove('sel'));
    g.classList.add('sel');
    picked.textContent = text;
  } });
  const bells = Object.values(tower.bells).reduce((a, b) => a + b, 0);
  const caps = Object.values(tower.caps).filter(Boolean).length;
  const legend = h('div', { class: 'tw-legend' }, ...Object.keys(T.SHAPE_NAMES).map((k) => {
    const mini = towerLegendIcon(k);
    return h('span', {}, mini, `${T.SHAPE_NAMES[k]} ${c[k]}`);
  }));
  const row = T.lanternRow(tower, ctx.day);
  const lanterns = h('div', { class: 'tw-lanterns', role: 'img', 'aria-label': `최근 28일 중 청사초롱을 켠 날 ${row.filter((d) => d.lit).length}일` },
    ...row.map((d) => sv('svg', { viewBox: '0 0 16 24' }, lanternSvg(d.lit))));
  show(h('section', { class: 'card' },
    h('div', { class: 'row between' }, h('h2', {}, '내 석탑'), h('span', { class: 'muted small' }, `풍경 ${bells} · 맨 위 돌 ${caps} · ${tower.done_at ? '상륜부 올림' : '상륜부 아직'}`)),
    svg, picked, legend,
    h('div', {}, h('div', { class: 'row between small' }, h('b', {}, '청사초롱 (하루 목표를 채운 날)'), h('span', { class: 'muted' }, `모두 ${tower.lantern_count}개`)), lanterns),
    h('div', { class: 'row' }, btn('처음으로', () => go('#/')))));
}
function towerLegendIcon(shape) {
  const id = `tw${++svgSeq}`;
  const svg = sv('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true', class: 'tw-icon' });
  svg.append(sv('defs', {},
    sv('linearGradient', { id: `${id}-gilt`, x1: 0, y1: 0, x2: 0, y2: 1 }, sv('stop', { offset: '0', 'stop-color': '#fff3b8' }), sv('stop', { offset: '.45', 'stop-color': '#f7d257' }), sv('stop', { offset: '1', 'stop-color': '#e0ac24' })),
    sv('pattern', { id: `${id}-hatch`, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, sv('rect', { width: 5, height: 5, class: 'tw-rough-bg' }), sv('line', { x1: 0, y1: 0, x2: 0, y2: 5, class: 'tw-hatch' }))));
  const r = { x: 0.6, y: 0.6, width: 14.8, height: 14.8, rx: 1.5 };
  if (shape === 'empty') svg.append(sv('rect', { ...r, class: 'tw-empty' }));
  else if (shape === 'rough') svg.append(sv('rect', { ...r, fill: `url(#${id}-hatch)`, class: 'tw-rough' }));
  else if (shape === 'gilt') svg.append(sv('rect', { ...r, fill: `url(#${id}-gilt)`, class: 'tw-gilt' }));
  else { svg.append(sv('rect', { ...r, class: 'tw-solid' })); if (shape === 'cracked') svg.append(sv('path', { d: 'M5 1 l2.5 5.5 l-2 3 l3.5 6', class: 'tw-crack' })); }
  return svg;
}

// ---------- 도움 판 (flows 7장, AC-48~53) ----------
// 답하기 전 ② · ③에서는 가린 줄의 풀이 · 우리말 코드 · 질문을 가리고, 바꿔 보기와 전체 풀이를 닫는다(답이 보이지 않게).
function helpSheet() {
  const rd = state.round;
  const { p } = rd;
  const stage = rd.retry ? R.STAGE.MASK : rd.item.stages[rd.stageIdx];
  const hideLine = rd.locked && stage !== R.STAGE.VIEW ? (rd.retry ? rd.retry.m.line : p.masks[rd.item.mask].line) : null;
  const tabs = [['faq', '이 줄 질문'], ['ko', '우리말 코드'], ['words', '낱말 뜻']];
  if (hideLine === null) {
    if (p.play) tabs.push(['play', '바꿔 보기']);
    tabs.push(['all', '전체 풀이']);
  }
  if (!tabs.some(([k]) => k === rd.helpTab)) rd.helpTab = 'faq';
  const pane = h('div', { class: 'pane' });
  const lineText = (arr, i) => (i === hideLine ? '▒▒▒' : arr[i]);

  if (rd.helpTab === 'faq') {
    const faq = h('div', { class: 'faq' });
    for (const [line, list] of Object.entries(p.faq || {})) {
      if (Number(line) === hideLine) continue;
      for (const f of list) faq.append(h('details', {}, h('summary', {}, `${Number(line) + 1}번 줄 · `, codeText(f.q)), h('p', {}, codeText(f.a))));
    }
    pane.append(faq.childElementCount ? faq : h('p', { class: 'muted' }, '아직 자주 묻는 질문이 없어요.'));
  } else if (rd.helpTab === 'ko') {
    pane.append(h('div', { class: 'lines' }, ...p.ko.map((k, i) => h('div', {}, h('span', { class: 'n' }, String(i + 1)), h('span', {}, lineText(p.ko, i))))));
  } else if (rd.helpTab === 'words') {
    const meaning = h('div', { class: 'why' }, h('span', { class: 'muted' }, '낱말을 눌러 보세요.'));
    const chips = h('div', { class: 'chips' });
    for (const w of p.words || []) {
      const info = state.words[w];
      if (!info) continue;
      chips.append(h('button', { type: 'button', class: 'chip', onclick: (e) => {
        chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === e.currentTarget));
        const kids = [h('p', {}, h('b', {}, w), ` — ${info.mean}`)];
        if (info.term) { // 필드워드 용어 카드 링크 (AC-51)
          const name = termName(info.term) || info.term;
          kids.push(h('a', { href: `${FW_BASE}#/term/${encodeURIComponent(info.term)}`, target: '_blank', rel: 'noopener' }, `필드워드에서 '${name}' 카드 보기`));
        }
        meaning.replaceChildren(...kids);
      } }, w));
    }
    pane.append(chips, meaning);
  } else if (rd.helpTab === 'play') {
    pane.append(playPane(p));
  } else if (rd.helpTab === 'all') {
    pane.append(h('div', { class: 'lines' }, ...p.explain.map((e, i) => h('div', {}, h('span', { class: 'n' }, String(i + 1)), h('span', {}, codeText(e))))));
  }
  return h('div', { class: 'sheet' },
    h('div', { class: 'tools', role: 'tablist' }, ...tabs.map(([k, label]) => h('button', {
      type: 'button', role: 'tab', class: 'tool' + (rd.helpTab === k ? ' on' : ''), 'aria-selected': rd.helpTab === k ? 'true' : 'false',
      onclick: () => { rd.helpTab = k; renderStage(); },
    }, label))),
    pane);
}

// 바꿔 보기: 정해 둔 칸 · 값만 바꿔 실행 (AC-52, 학습자가 쓴 코드는 실행하지 않음 AC-04)
function playPane(p) {
  const selects = p.play.slots.map((s) => h('select', { 'aria-label': s.name }, ...s.values.map((v) => h('option', { value: v }, v))));
  const out = h('div', { class: 'out' });
  const live = h('p', { class: 'live' });
  const runIt = async () => {
    let code = [...p.code];
    p.play.slots.forEach((s, k) => { code = code.map((l, j) => (j === s.line ? l.replace(s.token, selects[k].value) : l)); });
    const r = await run(code, null);
    out.replaceChildren(r.error ? h('span', { class: 'diff' }, r.kind === 'blocked' ? '이 브라우저에서는 실행할 수 없어요' : r.error) : (r.out.join('\n') || '(출력 없음)'));
    live.textContent = '';
  };
  return h('div', { class: 'side' },
    h('div', { class: 'pg' }, ...p.play.slots.map((s, k) => h('label', {}, `${s.name} `, selects[k]))),
    h('div', { class: 'row' }, btn('이대로 실행 ▶', runIt)),
    out, live);
}

boot();
