// 코드 가려 보기 — 오늘 할 일 · 시작 단계 · 선행 문제 · 배치 시험 (화면 없음)
// 근거: docs/flows.md 1 · 2 · 3장, 수용 기준 AC-14~16 · 23~25 · 28 · 31 · 33~37 · 46~47c.
// 하루 분량 숫자는 필드워드 site/js/review.js 23 · 25 · 300줄과 같다(관찰). 단위만 "장" 대신 "단계".

import { STAGE, hasAnswered } from './review.js';

export const DAILY_GOAL = 10;        // 하루 목표 10단계, AC-33
export const MIN_GOAL = 3;           // 최소 목표 3단계, AC-33
export const NEW_RATIO = 0.3;        // 목표의 30%는 새 문제 몫, AC-34
export const BACKLOG_FACTOR = 2;     // 밀린 복습이 목표의 2배를 넘으면 새 문제 1개, AC-35
export const PLACEMENT_LEVELS = [1, 2, 3, 4]; // 배치 시험: 등급마다 1문제, AC-46

// 급한 순서: 착각 → 헷갈림 → 모름 → 불안 → 앎 (필드워드 review.js URGENCY와 같음)
const URGENCY = { misconception: 0, confused: 1, unknown: 2, shaky: 3, known: 4 };
const urgency = (rec) => (rec.mis ? URGENCY.misconception : URGENCY[rec.status] ?? URGENCY.unknown);

// ----- 배치 시험 (AC-46 · 47 · 47a · 47b) -----
// 등급마다 데이터 순서로 첫 문제 1개. 가릴 줄은 후보 0번, 단계는 ②.
export function placementProblems(problems) {
  return PLACEMENT_LEVELS.map((lv) => problems.find((p) => p.level === lv)).filter(Boolean)
    .map((p) => ({ id: p.id, level: p.level, stages: [STAGE.MASK], mask: 0 }));
}

// answers: { [level]: true | false } (4문제 모두 낸 뒤, flows 1장). skipped면 건너뜀.
export function placementResult(answers, { skipped = false } = {}) {
  if (skipped) return { done: true, skipped: true, start_level: 1, passed_levels: [] };       // AC-47
  const passed = PLACEMENT_LEVELS.filter((lv) => answers[lv] === true);
  const firstWrong = PLACEMENT_LEVELS.find((lv) => answers[lv] !== true);
  return { done: true, skipped: false, start_level: firstWrong ?? 4, passed_levels: passed };   // AC-47a · 47b
}

// ----- 선행 문제 (AC-36 · 36a) -----
// 선행 문제를 한 번이라도 풀었거나, 배치 시험에서 그 등급을 맞혔으면 푼 것으로 본다.
export function prereqMet(problem, byId, records, placement) {
  const passed = new Set((placement && placement.passed_levels) || []);
  return (problem.prereq || []).every((q) => {
    const pre = byId.get(q);
    if (!pre) return false;
    return hasAnswered(records[q]) || passed.has(pre.level);
  });
}

// ----- 한 판의 단계 (AC-14 · 15 · 16 · 23 · 24 · 31 · 47c) -----
export function stagesForNew(problem, placement) {
  const passed = new Set((placement && placement.passed_levels) || []);
  return passed.has(problem.level) ? [STAGE.MASK] : [STAGE.VIEW, STAGE.MASK];
}

// 복습 판: 한 단계만(AC-16).
// - 착각 중: 같은 줄 ②(AC-31)
// - 첫 복습: ③ 해석 고르기(AC-15). 단, 첫 답이 모름이면 ①(AC-23)
// - 그 뒤: next_stage(모름 → ①, 나머지 → ②, AC-23 · 24)
export function reviewItem(problem, rec) {
  if (rec.mis) {
    const k = problem.masks.findIndex((m) => m.line === rec.mis.line);
    return { stages: [STAGE.MASK], mask: k >= 0 ? k : 0 };
  }
  const mask = rec.mask_next ?? 0;
  if (rec.reviews === 0 && rec.next_stage !== STAGE.VIEW) return { stages: [STAGE.INTERPRET], mask };
  return { stages: [rec.next_stage], mask };
}

const costOf = (stages) => stages.length; // 한 단계 = 1

// ----- 오늘 할 일 (flows 2장) -----
// records: { [문제 id]: 기록 }, today: { steps_done, new_steps_done, seen: [문제 id] }
// extra: 목표를 채운 뒤 "더 하기"로 오늘만 늘리는 단계 수
export function dailyPlan({ problems, records, day, today = {}, placement = null, goal = DAILY_GOAL, extra = 0 }) {
  const byId = new Map(problems.map((p) => [p.id, p]));
  const seen = new Set(today.seen || []);
  const target = goal + extra;
  const left = Math.max(target - (today.steps_done || 0), 0);

  // 복습: 다음 복습 날짜가 오늘 이전, 오늘 아직 안 본 것. 나중에 다시(1순위) → 급한 상태 → 오래된 날짜
  const due = problems
    .filter((p) => records[p.id] && !seen.has(p.id) && records[p.id].next_review_at <= day)
    .map((p) => ({ p, rec: records[p.id] }))
    .sort((a, b) =>
      (b.rec.priority_day ? 1 : 0) - (a.rec.priority_day ? 1 : 0) ||
      urgency(a.rec) - urgency(b.rec) ||
      a.rec.next_review_at.localeCompare(b.rec.next_review_at));
  const reviews = due.map(({ p, rec }) => ({ id: p.id, kind: 'review', ...reviewItem(p, rec) }));
  const dueSteps = reviews.reduce((s, r) => s + costOf(r.stages), 0);

  // 새 문제 후보: 기록 없음 · 선행 충족, 시작 등급부터 낮은 등급 순(AC-36 · 37). 시작 등급 아래는 그 뒤에.
  const start = (placement && placement.start_level) || 1;
  const fresh = problems
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !records[p.id] && !seen.has(p.id) && prereqMet(p, byId, records, placement))
    .sort((a, b) => (a.p.level < start) - (b.p.level < start) || a.p.level - b.p.level || a.i - b.i)
    .map(({ p }) => ({ id: p.id, kind: 'new', stages: stagesForNew(p, placement), mask: 0 }));

  // 새 문제 몫: 목표의 30%(10단계면 3단계). 밀린 복습이 목표의 2배를 넘으면 새 문제 1개만(AC-34 · 35).
  const backlog = dueSteps > goal * BACKLOG_FACTOR;
  const newDone = today.new_steps_done || 0;
  const reserveSteps = Math.max(Math.round(goal * NEW_RATIO) - newDone, 0);
  const newPart = [];
  const reviewPart = [];
  let used = 0;   // 새 문제 단계
  let rUsed = 0;  // 복습 단계
  const fits = (c) => used + rUsed + c <= left;
  const takeNew = (f) => {
    const c = costOf(f.stages);
    if (!fits(c)) return false;
    newPart.push(f); used += c;
    return true;
  };

  // 1) 새 문제 몫을 먼저 잡는다. 밀린 날은 오늘 새 문제를 아직 안 했을 때만 1개.
  if (backlog) {
    if (newDone === 0 && fresh.length) takeNew(fresh[0]);
  } else {
    for (const f of fresh) {
      if (used + costOf(f.stages) > reserveSteps || !takeNew(f)) break;
    }
  }
  // 2) 복습으로 남은 자리를 채운다.
  for (const r of reviews) {
    const c = costOf(r.stages);
    if (!fits(c)) break;
    reviewPart.push(r); rUsed += c;
  }
  // 3) 복습이 적어 자리가 남으면 새 문제로 채운다(필드워드와 같음). 밀린 날은 1개 그대로.
  if (!backlog) {
    for (const f of fresh.slice(newPart.length)) if (!takeNew(f)) break;
  }

  return {
    goal: target,
    min_goal: MIN_GOAL,
    done: today.steps_done || 0,
    queue: interleave(reviewPart, newPart),
    review_steps: rUsed,
    new_steps: used,
    due_steps: dueSteps,
    backlog,
  };
}

// 복습 2개마다 새 문제 1개 (필드워드 interleave와 같음)
export function interleave(reviews, fresh) {
  const out = [];
  let r = 0, f = 0;
  while (r < reviews.length || f < fresh.length) {
    for (let k = 0; k < 2 && r < reviews.length; k++) out.push(reviews[r++]);
    if (f < fresh.length) out.push(fresh[f++]);
  }
  return out;
}
