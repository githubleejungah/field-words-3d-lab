// 코드 가려 보기 — 학습자 코드 등급 · 승급 · 이정표 · 주간 착각 비율 (화면 없음)
// 근거: docs/flows.md 6 · 13장, docs/data-model.md 4장, 수용 기준 AC-38~45 · AC-75 · AC-76 · AC-89~94.

import { isLearned, daysBetween, addDays } from './review.js';

export const LEVEL_NAMES = { 1: '입문', 2: '기본', 3: '실무', 4: '심화' }; // 필드워드 site/i18n/ko.json level.1~4와 같은 글자, AC-38
export const LEVEL_MIN = 1;
export const LEVEL_MAX = 4;
export const PROMOTE_RATIO = 0.8;     // 한 등급 문제의 80% 이상이 익힘이면 승급, AC-39
export const MILESTONE_EVERY = 5;     // 한 등급 안에서 익힌 문제 5개마다 이정표, AC-43
export const WEEK_DAYS = 7;           // 주간 착각 비율의 한 주, AC-75

// 한 등급의 익힘 수 · 문제 수 · 승급에 필요한 수(80%를 올림)
export function levelProgress(problems, records, level) {
  const inLevel = problems.filter((p) => p.level === level);
  const learned = inLevel.filter((p) => isLearned(records[p.id])).length;
  const need = Math.ceil(inLevel.length * PROMOTE_RATIO - 1e-9);
  return { total: inLevel.length, learned, need };
}

// 남은 착각 수 (승급 배너에 함께 쓴다, AC-42)
export const misCount = (records) => Object.values(records).filter((r) => r && r.mis).length;

// 한 판이 끝날 때 부른다.
// stored: cm:v1:grade 값 { level, milestones_shown } (없으면 startLevel로 시작)
// 돌려주는 값: { grade: 새로 저장할 값, banner: null | { type: 'promote', level, name, misconceptions } | { type: 'milestone', level, name, learned } }
export function updateGrade(stored, problems, records, { startLevel = LEVEL_MIN } = {}) {
  const start = stored && stored.level ? stored.level : startLevel;
  let level = start;
  // 등급 안 문제가 0개면 올리지 않는다(빈 등급으로 저절로 오르지 않게).
  for (;;) {
    const { total, learned, need } = levelProgress(problems, records, level);
    if (level >= LEVEL_MAX || total === 0 || learned < need) break;
    level += 1;
  }
  level = Math.max(level, start); // 내리지 않는다, AC-40 (착각이 있어도 미루지 않는다, AC-41)

  const { learned } = levelProgress(problems, records, level);
  const reached = Math.floor(learned / MILESTONE_EVERY);

  if (level > start) {
    // 승급 배너 하나만(AC-44). 새 등급에서 이미 지난 이정표는 보여 준 것으로 친다.
    const n = misCount(records);
    return {
      grade: { level, milestones_shown: reached },
      banner: { type: 'promote', level, name: LEVEL_NAMES[level], ...(n >= 1 ? { misconceptions: n } : {}) },
    };
  }
  const shown = stored && Number.isInteger(stored.milestones_shown) ? stored.milestones_shown : 0;
  if (reached > shown) {
    return {
      grade: { level, milestones_shown: reached },
      banner: { type: 'milestone', level, name: LEVEL_NAMES[level], learned: reached * MILESTONE_EVERY },
    };
  }
  return { grade: { level, milestones_shown: shown }, banner: null };
}

// ----- 주간 착각 비율 (AC-75 · 76) -----
// log: cm:v1:log 값 { "YYYY-MM-DD": { answers, misconceptions } }
// 착각 다시 풀기 답(retry)은 세지 않는다: 같은 줄을 맞힐 때까지 다시 푸는 답이라 비율을 부풀린다.
export function logAnswer(log, { day, status, retry = false }) {
  if (retry) return log;
  const d = log[day] || { answers: 0, misconceptions: 0 };
  return { ...log, [day]: { answers: d.answers + 1, misconceptions: d.misconceptions + (status === 'misconception' ? 1 : 0) } };
}

// 첫 사용일부터 7일씩 끊는다. 답이 없는 주는 ratio가 null.
export function weeklyMisRatio(log, firstDay, today) {
  const weeks = Math.floor(daysBetween(firstDay, today) / WEEK_DAYS) + 1;
  const out = Array.from({ length: Math.max(weeks, 1) }, (_, i) => ({ week: i + 1, answers: 0, misconceptions: 0, ratio: null }));
  for (const [day, v] of Object.entries(log)) {
    const w = Math.floor(daysBetween(firstDay, day) / WEEK_DAYS);
    if (w < 0 || w >= out.length) continue;
    out[w].answers += v.answers;
    out[w].misconceptions += v.misconceptions;
  }
  for (const w of out) w.ratio = w.answers ? w.misconceptions / w.answers : null;
  return out;
}

// ----- 4주 변화 재기 (검증 시작일, AC-89~94, flows 13장) -----
// 기록 키 cm:v1:validation = { start, history[] }. 주간 비율은 cm:v1:log에서 매번 계산하고, 끝난 결과만 history에 남긴다.
export const VALIDATION_DAYS = 28; // 4주(Q15). 1주차 = start ~ +6일, 4주차 = +21 ~ +27일

// 주차를 셀 첫날: 검증 시작일이 있으면 그날(AC-90), 없으면 처음 답한 날(AC-91)
export function weekStart(validation, log) {
  if (validation && validation.start) return validation.start;
  const days = Object.keys(log || {}).sort();
  return days.length ? days[0] : null;
}

// 처음 화면에 보여 줄 상태: none(시작 전) · running(n주차) · done(1주차 · 4주차 결과)
export function validationView(validation, log, today) {
  if (!validation || !validation.start) return { state: 'none' };
  const elapsed = daysBetween(validation.start, today);
  if (elapsed < VALIDATION_DAYS) return { state: 'running', week: Math.floor(Math.max(elapsed, 0) / WEEK_DAYS) + 1 };
  const weeks = weeklyMisRatio(log || {}, validation.start, addDays(validation.start, VALIDATION_DAYS - 1)); // 5주차 이후 답은 넣지 않는다
  return { state: 'done', week1: weeks[0], week4: weeks[3], success: successMet(weeks), end: addDays(validation.start, VALIDATION_DAYS - 1) };
}

// 시작(AC-89): 재는 중이면 다시 시작하지 않는다(AC-92). 끝났으면 지난 결과를 남기고 새로 시작(AC-94).
export function startValidation(validation, log, today) {
  const history = (validation && validation.history) || [];
  if (!validation || !validation.start) return { start: today, history };
  const view = validationView(validation, log, today);
  if (view.state !== 'done') return validation; // 28일 전에는 바꾸지 않는다
  const pick = (w) => ({ answers: w.answers, misconceptions: w.misconceptions });
  return { start: today, history: [...history, { start: validation.start, end: view.end, week1: pick(view.week1), week4: pick(view.week4) }] };
}

// 성공 지표: 4주차 비율이 1주차보다 낮다(AC-76). 둘 중 하나라도 답이 없으면 아직 모른다(null).
export function successMet(weeks) {
  const w1 = weeks[0], w4 = weeks[3];
  if (!w1 || !w4 || w1.ratio === null || w4.ratio === null) return null;
  return w4.ratio < w1.ratio;
}
