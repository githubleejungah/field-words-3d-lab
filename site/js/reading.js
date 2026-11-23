// 실전 읽기 확인 — 할 때인지 · 읽을 코드 고르기 · 점수 (화면 없음)
// 근거: docs/flows.md 12장, docs/data-model.md 7장, docs/adr/0004. 수용 기준 AC-77~85.
// 기록 키는 cm:v1:reading 하나뿐이다. review.js · plan.js · grade.js는 이 기록을 읽지 않는다(AC-84).

import { daysBetween } from './review.js';

export const READING_EVERY_DAYS = 28; // AC-78: 마지막 회차 뒤 28일. 성공 지표 4주 비교(Q15)와 같은 주기
export const PARTIAL_POINT = 0.5;     // AC-83: 부분 = 0.5점 (추론, AS-12)
export const CODE_MIN_LINES = 20;     // AC-79: 20~30줄 (추론, AS-10)
export const CODE_MAX_LINES = 30;
export const POINTS_MIN = 3;          // AC-82: 꼭 짚을 점 3~5개 (추론, AS-12)
export const POINTS_MAX = 5;
export const MARK = { hit: 1, partial: PARTIAL_POINT, miss: 0 }; // 맞힘 · 부분 · 놓침

const filled = (s) => typeof s === 'string' && s.trim() !== '';

// 사이트가 읽을 때 하는 가벼운 모양 검사. 깨진 코드는 내지 않는다(AC-66과 같은 방식).
// 자세한 검사(비밀 값 모양 등)는 tools/check_problems.mjs의 checkReadings가 커밋 전에 한다.
export function validReading(r) {
  try {
    const n = r.code.length;
    return filled(r.id) && r.code.every((l) => typeof l === 'string') && n >= CODE_MIN_LINES && n <= CODE_MAX_LINES &&
      filled(r.model.what) && filled(r.model.io) && filled(r.model.key.why) &&
      Number.isInteger(r.model.key.line) && r.model.key.line >= 0 && r.model.key.line < n &&
      Array.isArray(r.points) && r.points.length >= POINTS_MIN && r.points.length <= POINTS_MAX && r.points.every(filled);
  } catch { return false; }
}

const runsOf = (rec) => (rec && Array.isArray(rec.runs) ? rec.runs : []);

// 할 때인가: 배치 시험을 마쳤거나 건너뛴 뒤(AC-77), 기록이 0회이거나 마지막 회차 뒤 28일이 지났으면(AC-78)
export function readingDue(rec, placement, day) {
  if (!placement) return false;
  const runs = runsOf(rec);
  if (!runs.length) return true;
  return daysBetween(runs[runs.length - 1].day, day) >= READING_EVERY_DAYS;
}

// 읽을 코드: 안 읽은 코드를 데이터 순서대로 먼저. 다 읽었으면 마지막으로 읽은 날이 가장 오래된 코드(다시 읽음)
export function pickReading(readings, rec) {
  if (!readings.length) return null;
  const lastDay = new Map();
  for (const r of runsOf(rec)) lastDay.set(r.reading_id, r.day); // 회차는 날짜 순서로 쌓이므로 마지막 값이 남는다
  const fresh = readings.find((r) => !lastDay.has(r.id));
  if (fresh) return { reading: fresh, repeat: false };
  let oldest = readings[0];
  for (const r of readings) if (lastDay.get(r.id) < lastDay.get(oldest.id)) oldest = r;
  return { reading: oldest, repeat: true };
}

// 점수 = (맞힘 1 + 부분 0.5) ÷ 꼭 짚을 점 수, 소수 둘째 자리 (AC-83). 예: [1, 0.5, 0, 1] → 2.5 ÷ 4 = 0.625 → 0.63
export function readingScore(marks) {
  if (!marks.length) return 0;
  const sum = marks.reduce((a, b) => a + b, 0);
  return Math.round((sum / marks.length) * 100) / 100;
}

// 회차 1개를 더한 새 기록. score는 그때 값으로 남긴다(나중에 꼭 짚을 점이 바뀌어도 지난 점수는 그대로, data-model 결정 9)
export function addRun(rec, { reading_id, day, answers, marks, repeat = false }) {
  const run = { reading_id, day, answers: { ...answers }, marks: [...marks], score: readingScore(marks), repeat: !!repeat };
  return { runs: [...runsOf(rec), run] };
}

// 처음 화면 · 끝 화면에 보여 줄 회차 순서 기록 (AC-83)
export function readingHistory(rec) {
  return runsOf(rec).map((r, i) => ({ n: i + 1, percent: Math.round(r.score * 100), repeat: !!r.repeat, day: r.day }));
}
