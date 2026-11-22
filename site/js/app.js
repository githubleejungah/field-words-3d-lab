// 코드 가려 보기 — 화면 그리기 · 화면 이동
// 근거: docs/flows.md 1 · 3 · 5 · 6 · 7장, docs/architecture.md 4-1.
// 규칙은 review.js · grade.js · plan.js에 있고, 이 파일은 그리기와 순서만 맡는다.
// 학습자 화면에는 규칙 설명 글을 두지 않는다(Q18). 글자는 모두 textContent로 넣는다(innerHTML 안 씀).

import * as R from './review.js';
import * as G from './grade.js';
import * as P from './plan.js';
import * as S from './store.js';
import { run, maskedLines } from './runner.js';

const FW_BASE = 'https://githubleejungah.github.io/field-words/';
// 배포하면 같은 주소 아래 필드워드 사전을 읽는다(A12 · AS-8). 개발 중에는 상위 폴더에서 서버를 띄우면 두 번째 주소로 읽힌다.
const GLOSSARY_URLS = ['/field-words/data/glossary.json', '/field-words/site/data/glossary.json'];
const MORE_STEPS = 5; // 목표를 채운 뒤 "더 하기" (필드워드 app.js와 같은 5)
const CONF = [['sure', '확실해요'], ['unsure', '헷갈려요'], ['dontknow', '몰라요']];
const STATUS_KO = { known: '✅ 앎', shaky: '🟡 불안', confused: '🟠 헷갈림', misconception: '🚨 착각', unknown: '⚪ 모름' };
const STAGE_KO = { 1: '① 해석 보기', 2: '② 가려 보기', 3: '③ 해석 고르기' };

const state = { problems: [], byId: new Map(), words: {}, glossary: null, round: null };
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
function show(...nodes) { $app.replaceChildren(...nodes.filter(Boolean)); window.scrollTo(0, 0); }
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
  state.glossary = await loadGlossary();
  window.addEventListener('hashchange', route);
  route();
}

function route() {
  const hash = location.hash || '#/';
  if (hash === '#/play') playNext();
  else if (hash === '#/placement') placement();
  else home();
  updateTodayBar();
}
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

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
  const days = Object.keys(log).sort();
  let ratioCard = null;
  if (days.length) {
    const weeks = G.weeklyMisRatio(log, days[0], ctx.day);
    const cur = weeks[weeks.length - 1];
    if (cur.ratio !== null) ratioCard = h('p', { class: 'muted' }, `이번 주 착각 비율 ${Math.round(cur.ratio * 100)}% (${cur.misconceptions} / ${cur.answers})`);
  }
  show(todayCard, gradeCard, ratioCard);
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
      opts.append(h('button', { type: 'button', class: 'opt', onclick: () => { answers[it.level] = o.correct === true; i += 1; next(); } }, o.text));
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
    show(h('section', { class: 'card' },
      h('h2', {}, `${G.LEVEL_NAMES[res.start_level]}부터 시작해요`),
      h('div', { class: 'row' }, btn('시작하기', () => go('#/play')))));
  };
  next();
}

// ---------- 코드 그리기 ----------
// opts: maskLine(가린 줄), cur(지금 줄), labels(덩어리 이름표, ①에서만 — AC-55 · 56)
function codeView(p, { maskLine = null, cur = null, labels = false } = {}) {
  const box = h('div', { class: 'code', role: 'region', 'aria-label': '코드' });
  const labelAt = new Map((labels ? p.labels : []).map((l) => [l.from, l.text]));
  p.code.forEach((line, i) => {
    if (labelAt.has(i)) box.append(h('div', { class: 'ln lab' }, labelAt.get(i)));
    const cls = ['ln'];
    if (i === cur) cls.push('cur');
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
  const wrap = h('div', { class: 'side' }, h('div', { class: 'pair' }, col(orig, '원래 코드'), col(masked, `${line + 1}번 줄을 가린 코드`)));
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
    answers: [],      // { status, retry }
    banner: null,
    helpOpen: false, helpTab: 'faq', locked: false,
  };
  renderStage();
}

function roundFrame(content) {
  const rd = state.round;
  const { p, item } = rd;
  const terms = p.terms.map((t) => termName(t)).filter(Boolean);
  const ladder = h('div', { class: 'ladder' },
    ...item.stages.map((s, i) => h('span', { class: 'step' + (i === rd.stageIdx && !rd.retry ? ' on' : i < rd.stageIdx ? ' done' : '') }, STAGE_KO[s])),
    rd.retry ? h('span', { class: 'step on' }, '다시 풀기') : null,
    btn(rd.helpOpen ? '도움 닫기' : '? 궁금해요', () => { rd.helpOpen = !rd.helpOpen; renderStage(); }, 'btn ghost small help-btn'));
  const meta = h('div', { class: 'meta' }, h('span', { class: 'lv' }, G.LEVEL_NAMES[p.level]), ...terms.map((t) => h('span', { class: 'term' }, t)));
  return h('section', { class: 'card' }, meta, ladder, rd.helpOpen ? helpSheet() : null, content);
}

function renderStage() {
  const rd = state.round;
  if (rd.retry) return renderRetry();
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

// ① 해석 보기: 비유 1문장 · 이름표 · 한 줄 실행 (AC-17 · 54 · 55)
function renderView() {
  const rd = state.round;
  const { p } = rd;
  rd.locked = false;
  if (rd.traceIdx === undefined) rd.traceIdx = -1;
  const scene = rd.traceIdx >= 0 ? p.trace[rd.traceIdx] : null;
  const term = state.glossary && p.terms.map((t) => state.glossary.get(t)).find(Boolean);
  const analogy = term ? h('p', { class: 'analogy' }, h('b', {}, `비유 · ${term.term_ko} `), term.analogy) : null;
  const vars = scene ? Object.entries(scene.vars).map(([k, v]) => `${k} = ${v}`).join('\n') : '';
  const atEnd = rd.traceIdx >= p.trace.length - 1;
  const stepBtn = btn(atEnd ? '처음부터 ↺' : '한 줄 실행 ▶', () => { rd.traceIdx = atEnd ? -1 : rd.traceIdx + 1; renderStage(); });
  const nextBtn = btn(rd.item.stages.length > 1 ? `다음: ${STAGE_KO[rd.item.stages[rd.stageIdx + 1]]} ▶` : '다 봤어요 ▶', () => {
    rd.rec = R.recordView(rd.rec, { day: rd.ctx.day, review: rd.item.kind === 'review' });
    rd.traceIdx = undefined;
    nextStage();
  }, 'btn ghost');
  show(roundFrame(h('div', { class: 'cols' },
    h('div', { class: 'side' }, analogy, codeView(p, { cur: scene ? scene.line : null, labels: true }), h('div', { class: 'row' }, stepBtn, nextBtn)),
    h('div', { class: 'side' },
      h('div', { class: 'box' }, h('span', { class: 'box-t' }, '지금 줄이 하는 일'),
        h('p', {}, scene ? `${scene.line + 1}번 줄 · ${scene.note}` : '[한 줄 실행]을 눌러 보세요.')),
      h('div', { class: 'pair' },
        h('div', { class: 'box' }, h('span', { class: 'box-t' }, '변수 상자'), h('div', { class: 'var' }, vars)),
        h('div', { class: 'box' }, h('span', { class: 'box-t' }, '출력'), h('div', { class: 'out' }, scene ? scene.out.join('\n') : '')))))));
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
  const right = h('div', { class: 'side' }, h('p', { class: 'q' }, question));

  // 확신도 3개 (AC-18)
  const confRow = h('div', { class: 'conf', role: 'group', 'aria-label': '확신도' },
    ...CONF.map(([k, label]) => h('button', {
      type: 'button', class: 'btn' + (qz.conf === k ? '' : ' ghost'), disabled: !!qz.conf, 'aria-pressed': qz.conf === k ? 'true' : 'false',
      onclick: () => {
        qz.conf = k;
        if (k === 'dontknow') answer(stage, null); // 몰라요: 보기 없이 정답 + 풀이 (AC-22)
        else renderStage();
      },
    }, label)));
  right.append(confRow);

  if (qz.conf && qz.conf !== 'dontknow') {
    const opts = h('div', { class: 'opts' });
    for (const o of qz.options) {
      const cls = ['opt'];
      if (qz.picked === o) cls.push('pick');
      if (qz.result && o.correct) cls.push('ans');
      opts.append(h('button', { type: 'button', class: cls.join(' '), disabled: !!qz.picked, onclick: () => { qz.picked = o; if (isMask) renderStage(); else answer(stage, o); } }, o.text));
    }
    right.append(opts);
    if (isMask && qz.picked && !qz.result) right.append(h('div', { class: 'row' }, btn('실행해서 확인하기 ▶', () => answer(stage, qz.picked))));
  }

  if (qz.result) {
    if (qz.ran) right.append(compareView(qz.ran.orig, qz.ran.masked, m.line));
    right.append(resultView(qz.result, quizData));
  }
  const code = isMask ? codeView(p, { maskLine: qz.ran ? null : m.line, cur: qz.ran ? m.line : null }) : codeView(p, { cur: m.line });
  show(roundFrame(h('div', { class: 'cols' }, h('div', { class: 'side' }, code), right)));
}

async function answer(stage, picked) {
  const rd = state.round;
  const { p, item } = rd;
  const m = p.masks[item.mask];
  const qz = rd.quiz;
  const correct = qz.conf === 'dontknow' ? false : !!(picked && picked.correct);
  if (stage === R.STAGE.MASK) {
    const [orig, masked] = await Promise.all([run(p.code, p.outputs.original), run(maskedLines(p.code, m.line), m.output)]);
    qz.ran = { orig, masked };
  }
  const res = R.recordAnswer(rd.rec, { day: rd.ctx.day, step: stage, mask: item.mask, line: m.line, confidence: qz.conf, correct, allOptions: true, review: item.kind === 'review' });
  rd.rec = res.record;
  rd.answers.push({ status: res.status });
  qz.result = { status: res.status, picked, conf: qz.conf };
  renderStage();
}

function resultView(result, quizData) {
  const rd = state.round;
  const correctOpt = quizData.options.find((o) => o.correct);
  const good = result.status === 'known' || result.status === 'shaky';
  const box = h('div', { class: 'res ' + (good ? 'good' : 'warm') }, h('p', { class: 'stat' }, STATUS_KO[result.status]));
  if (result.conf === 'dontknow') {
    box.append(h('p', {}, `정답: ${correctOpt.text}`), h('p', { class: 'why' }, correctOpt.why));
  } else if (result.picked && !result.picked.correct) {
    box.append(h('p', { class: 'why' }, result.picked.why), h('p', {}, `정답: ${correctOpt.text}`)); // 고른 보기의 착각 풀이 (AC-13)
  } else if (result.picked) {
    box.append(h('p', { class: 'why' }, result.picked.why));
  }
  const row = h('div', { class: 'row' });
  if (result.status === 'misconception') {
    // 그날 같은 줄을 맞힐 때까지 다시 (AC-25~28)
    row.append(btn('그 줄 풀이 보기 ▶', () => startRetry(result.picked)), btn('나중에 다시', postponeRound, 'btn ghost'));
  } else {
    row.append(btn(rd.stageIdx + 1 < rd.item.stages.length ? `다음: ${STAGE_KO[rd.item.stages[rd.stageIdx + 1]]} ▶` : '다음 ▶', nextStage));
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
      h('div', { class: 'side' }, codeView(p, { cur: m.line })),
      h('div', { class: 'side' },
        h('div', { class: 'box line-note' }, h('span', { class: 'box-t' }, `${m.line + 1}번 줄`),
          h('p', {}, p.explain[m.line]), ...scenes.map((s) => h('p', { class: 'muted' }, s.note))),
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
    opts.append(h('button', { type: 'button', class: cls.join(' '), disabled: !!rt.done, onclick: () => retryAnswer(o, options.length) }, o.text));
  }
  right.append(opts);
  if (rt.last && !rt.done) right.append(h('div', { class: 'res warm' }, h('p', { class: 'why' }, rt.last.why)));
  if (rt.done) {
    if (rt.ran) right.append(compareView(rt.ran.orig, rt.ran.masked, m.line));
    right.append(h('div', { class: 'res good' }, h('p', { class: 'stat' }, '맞혔어요'), h('p', { class: 'why' }, rt.done.why),
      h('div', { class: 'row' }, btn('다음 ▶', () => { rd.retry = null; nextStage(); }))));
  } else {
    right.append(h('div', { class: 'row' }, later));
  }
  show(roundFrame(h('div', { class: 'cols' }, h('div', { class: 'side' }, codeView(p, { maskLine: rt.done ? null : m.line, cur: rt.done ? m.line : null })), right)));
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
  S.setToday({ ...t, steps_done: t.steps_done + stepsDone, new_steps_done: t.new_steps_done + (item.kind === 'new' ? stepsDone : 0), seen: [...t.seen, p.id] });
  let log = S.read('log', {});
  for (const a of rd.answers) log = G.logAnswer(log, { day: ctx.day, status: a.status, retry: !!a.retry });
  S.write('log', log);

  const records = S.allRecords(state.problems);
  const { grade, banner } = G.updateGrade(S.read('grade', null), state.problems, records, { startLevel: startLevel(ctx) });
  S.write('grade', grade);
  updateTodayBar();

  const firsts = rd.answers.filter((a) => !a.retry);
  const plan = planNow();
  const card = h('section', { class: 'card' }, h('h2', {}, '한 판 끝'),
    firsts.length ? h('p', {}, firsts.map((a) => STATUS_KO[a.status]).join(' · ')) : null);
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
      for (const f of list) faq.append(h('details', {}, h('summary', {}, `${Number(line) + 1}번 줄 · ${f.q}`), h('p', {}, f.a)));
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
    pane.append(h('div', { class: 'lines' }, ...p.explain.map((e, i) => h('div', {}, h('span', { class: 'n' }, String(i + 1)), h('span', {}, e)))));
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
