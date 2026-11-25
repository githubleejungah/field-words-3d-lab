// 코드 가려 보기 — 파이썬 연습 규칙 (화면 없음)
// 근거: docs/flows.md 15장, docs/data-model.md 2-6 · 4, 수용 기준 AC-95~99 · 103.
// - 기록 키는 cm:v1:py:<id>, 동의는 cm:v1:py-consent 1칸. plan.js · grade.js · tower.js는 이 기록을 읽지 않는다(AC-97).
// - 복습 상자 · 단계 규칙은 review.js · plan.js를 그대로 쓴다(AC-98). 배치 시험 · 선행 문제 · 승급은 없다.
import { STAGE } from './review.js';
import { reviewItem } from './plan.js';
import { cellShape, daysUntil } from './tower.js';

export const recKey = (id) => `py:${id}`;
export const CONSENT_KEY = 'py-consent';
export const CONSENT_ON = 'on';
export const CONSENT_OFF = 'off';
// 동의 1칸 읽기: "on" · "off"만 인정하고 나머지는 "아직 안 물음"(null)
export const consentOf = (v) => (v === CONSENT_ON || v === CONSENT_OFF ? v : null);

const byLevel = (a, b) => a.level - b.level;

// 다음 연습 1개: 오늘 복습할 것(다음 복습 날짜가 오늘이거나 지남) 먼저, 그다음 안 푼 것. 둘 다 등급 순.
// 없으면 null. 돌려주는 값: { id, kind: 'review' | 'new', stages, mask }
export function pickNext(practices, records, day) {
  const due = practices.filter((p) => records[p.id] && records[p.id].next_review_at <= day).sort(byLevel);
  if (due.length) {
    const p = due[0];
    return { id: p.id, kind: 'review', ...reviewItem(p, records[p.id]) };
  }
  const fresh = practices.filter((p) => !records[p.id]).sort(byLevel);
  if (fresh.length) return { id: fresh[0].id, kind: 'new', stages: [STAGE.VIEW, STAGE.MASK], mask: 0 };
  return null;
}

// 복습할 것도 안 푼 것도 없을 때 [다시 풀어 보기]: 다음 복습이 가장 가까운 연습의 ② 한 단계.
// 상자는 그대로 둔다(기록을 저장하지 않음, flows 15장).
export function againItem(practices, records, day) {
  const done = practices.filter((p) => records[p.id]).sort((a, b) => (daysUntil(day, records[a.id]) - daysUntil(day, records[b.id])) || byLevel(a, b));
  if (!done.length) return null;
  const p = done[0];
  return { id: p.id, kind: 'again', stages: [STAGE.MASK], mask: records[p.id].mask_next ?? 0 };
}

// 가장 가까운 다음 복습까지 남은 날(없으면 null)
export function nextDueDays(practices, records, day) {
  const ds = practices.map((p) => daysUntil(day, records[p.id])).filter((d) => d !== null);
  return ds.length ? Math.min(...ds) : null;
}

// 돌 4칸 줄: 등급 순, 석탑과 같은 돌 모양 규칙 (AC-99)
export function stones(practices, records) {
  return [...practices].sort(byLevel).map((p) => ({ id: p.id, level: p.level, shape: cellShape(records[p.id]) }));
}
