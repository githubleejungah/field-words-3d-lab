// 코드 가려 보기 — 상태 판정 · 복습 상자 · 착각 표시 (화면 없음)
// 근거: docs/flows.md 4 · 5장, docs/data-model.md 4장, 수용 기준 AC-21~32.
// 숫자는 필드워드 site/js/review.js 16~20 · 59~71줄과 같다(관찰). 바꾸면 문서도 같이 고친다.
// 모든 함수는 순수 함수다: 기록을 받아 새 기록을 돌려주고, 저장은 store.js가 한다.

export const INTERVALS = [1, 2, 4, 7, 15, 30, 60]; // 상자 1~7의 복습 간격(일), AC-32
export const MAINTAIN_BOX = 8;                      // 상자 8 = 장기 기억 유지
export const MAINTAIN_DAYS = 120;
export const DROP_TWO_FROM_BOX = 4;                 // 상자 4 이상에서 틀리면 두 칸만 내린다
export const LEARNED_BOX = 4;                       // 익힘 = 상자 4 이상 (승급 계산)
export const HISTORY_KEEP = 20;
export const MIS_CLEAR_STREAK = 2;                  // 서로 다른 2일 연속 맞히면 착각 표시를 지운다, AC-29
export const OPTIONS = 4;                           // 보기 4개, AC-12
export const MAX_ATTEMPTS = OPTIONS;                // 틀린 보기를 빼면 처음 답 포함 최대 4번, AC-27

export const STAGE = { VIEW: 1, MASK: 2, INTERPRET: 3 }; // ① 해석 보기 · ② 가려 보기 · ③ 해석 고르기

// ----- 날짜: "YYYY-MM-DD" 글자로 다룬다(기기 시간대) -----
const pad = (n) => String(n).padStart(2, '0');
export function dateOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return dateOf(new Date(y, m - 1, d + n));
}
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// ----- 상태 5개: 확신도 × 정답 여부 (AC-21) -----
// confidence: 'sure'(확실해요) · 'unsure'(헷갈려요) · 'dontknow'(몰라요)
export function classify(confidence, correct) {
  if (confidence === 'dontknow') return 'unknown';
  if (confidence === 'sure') return correct ? 'known' : 'misconception';
  return correct ? 'shaky' : 'confused';
}

// ----- 상자 이동 (data-model 4-1) -----
export function nextBox(box, status) {
  if (status === 'known') return Math.min(Math.max(box, 0) + 1, MAINTAIN_BOX);
  if (status === 'shaky') return Math.max(box, 1);
  return box >= DROP_TWO_FROM_BOX ? box - 2 : 1;
}
export function intervalFor(box) {
  return box >= MAINTAIN_BOX ? MAINTAIN_DAYS : INTERVALS[Math.max(box, 1) - 1];
}

// ----- 다음 판의 시작 단계 (AC-23 · 24, flows 4장) -----
export function nextStageFor(status) {
  return status === 'unknown' ? STAGE.VIEW : STAGE.MASK;
}

function blank(day) {
  return { box: 0, status: null, next_stage: STAGE.MASK, mask_next: 0, reviews: 0, first_at: day, last_at: null, next_review_at: day, history: [] };
}

// ① 해석 보기를 봤을 때. 답이 없으므로 상자는 그대로다(flows 3장).
// review: 복습 판(①만 보는 판)이면 true. 처음 만난 판의 ①이면 false.
export function recordView(prev, { day, review = false }) {
  const rec = prev ? { ...prev } : blank(day);
  if (review) {
    rec.reviews += 1;
    rec.next_stage = STAGE.MASK; // ①만 본 판의 다음은 ②
  }
  return rec;
}

// ② · ③에서 답했을 때.
// - step: 2 또는 3, mask: 가린 후보 번호(0 · 1), line: 가린 줄 번호(0부터)
// - allOptions: 보기 4개가 모두 있었나(착각 다시 풀기에서 보기를 뺐으면 false)
// - retry: 착각 다시 풀기 답이면 true
// - review: 복습 판이면 true(처음 만난 판의 ②면 false)
// 돌려주는 값: { record, status, boxMoved, misCleared }
export function recordAnswer(prev, { day, step, mask, line, confidence, correct, allOptions = true, retry = false, review = false }) {
  const rec = prev ? { ...prev, history: [...prev.history] } : blank(day);
  const status = classify(confidence, correct);
  const firstToday = rec.last_at !== day && !retry;

  rec.history = [...rec.history, { at: day, step, mask, confidence, correct: !!correct, status, ...(retry ? { retry: true } : {}) }].slice(-HISTORY_KEEP);

  // 하루 첫 답만 상자 · 상태 · 다음 단계를 바꾼다(data-model 4-1). 다시 푼 답은 기록만 남긴다.
  if (firstToday) {
    rec.box = nextBox(rec.box, status);
    rec.status = status;
    rec.next_review_at = addDays(day, intervalFor(rec.box));
    rec.next_stage = nextStageFor(status);
    rec.last_at = day;
    if (review) rec.reviews += 1;
    delete rec.priority_day; // 나중에 다시로 미룬 문제를 풀었으면 1순위를 푼다
  }

  // 착각 표시 (AC-25 · 29 · 30 · 31)
  let misCleared = false;
  if (rec.mis) {
    if (line === rec.mis.line) rec.mis = updateMis(rec.mis, { day, confidence, correct, allOptions, retry });
    if (rec.mis.streak >= MIS_CLEAR_STREAK) { delete rec.mis; misCleared = true; }
  } else if (status === 'misconception' && !retry) {
    rec.mis = { line, streak: 0, last_day: day };
  }

  // 다음에 가릴 후보: 착각 중이면 같은 줄(AC-31), 아니면 번갈아(복습 땐 다른 줄, A14)
  if (rec.mis) rec.mask_next = mask;
  else if (firstToday) rec.mask_next = mask === 0 ? 1 : 0;

  return { record: rec, status, boxMoved: firstToday, misCleared };
}

// 서로 다른 날의 "보기 4개 + 확실해요 + 맞음"만 센다. 같은 줄을 틀리면 0으로(AC-30).
function updateMis(mis, { day, confidence, correct, allOptions, retry }) {
  const wrong = confidence === 'dontknow' || !correct;
  if (wrong) return { ...mis, streak: 0, last_day: day };
  const counts = confidence === 'sure' && allOptions && !retry && day > mis.last_day;
  if (counts) return { ...mis, streak: mis.streak + 1, last_day: day };
  return mis; // 헷갈려요 + 맞음, 같은 날 다시 맞힘, 보기를 뺀 답은 세지도 되돌리지도 않는다
}

// 착각 다시 풀기: 이미 고른 틀린 보기를 뺀다(AC-27).
export function remainingOptions(options, pickedTexts) {
  const picked = new Set(pickedTexts);
  return options.filter((o) => !picked.has(o.text));
}

// "나중에 다시": 다음 날 복습 1순위로(AC-28).
export function postpone(prev, { day }) {
  const tomorrow = addDays(day, 1);
  return { ...prev, next_review_at: tomorrow, priority_day: tomorrow };
}

export const isLearned = (rec) => !!rec && rec.box >= LEARNED_BOX;
export const hasAnswered = (rec) => !!rec && rec.history.some((h) => !h.retry);
