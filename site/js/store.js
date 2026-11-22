// 코드 가려 보기 — 학습 기록 읽기 · 쓰기 (docs/data-model.md 4장)
// localStorage를 못 쓰면(사생활 보호 창 등) 메모리에만 두고 이번 판을 이어 간다(AC-65).
// 앞글자는 cm:v1: 이다. 필드워드 기록(fw:v1:*)은 읽지도 쓰지도 않는다.

import { dateOf } from './review.js';

export const PREFIX = 'cm:v1:';
const memory = new Map();

function probe() {
  try {
    const k = PREFIX + '__probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export const persistent = typeof localStorage !== 'undefined' && probe();

function rawGet(key) {
  if (persistent) { try { return localStorage.getItem(PREFIX + key); } catch { /* 아래로 */ } }
  return memory.has(key) ? memory.get(key) : null;
}
function rawSet(key, value) {
  if (persistent) { try { localStorage.setItem(PREFIX + key, value); return; } catch { /* 아래로 */ } }
  memory.set(key, value);
}

export function read(key, fallback) {
  const raw = rawGet(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
export function write(key, value) { rawSet(key, JSON.stringify(value)); }

// ----- 날짜: 개발 중(localhost)에만 ?day=YYYY-MM-DD 로 날짜를 바꿔 복습을 시험할 수 있다 -----
export function today() {
  try {
    const host = location.hostname;
    const d = new URLSearchParams(location.search).get('day');
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && (host === 'localhost' || host === '127.0.0.1')) return d;
  } catch { /* Node 시험 등 */ }
  return dateOf(new Date());
}

// ----- 문제별 기록 -----
export const getProblem = (id) => read(`problem:${id}`, null);
export const setProblem = (id, rec) => write(`problem:${id}`, rec);
export function allRecords(problems) {
  const out = {};
  for (const p of problems) { const r = getProblem(p.id); if (r) out[p.id] = r; }
  return out;
}

// ----- 오늘 기록: 날짜가 바뀌면 새로 시작 -----
export function getToday(day) {
  const t = read('today', null);
  if (t && t.date === day) return { steps_done: 0, new_steps_done: 0, seen: [], extra: 0, ...t };
  return { date: day, steps_done: 0, new_steps_done: 0, seen: [], extra: 0 };
}
export const setToday = (t) => write('today', t);
