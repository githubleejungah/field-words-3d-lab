// 코드 가려 보기 — 코드 탑(삼층석탑) 규칙: 칸 모양 · 한 판 끝 장면 고르기 · 장식 갱신 (화면 없음)
// 근거: docs/flows.md 14장, docs/data-model.md 4장(cm:v1:tower) · 6장 11 · 12번, ADR-0006 · ADR-0008(칸 모양), 수용 기준 AC-44a~44t.
// 칸 모양은 저장하지 않고 학습 기록에서 매번 계산한다. 장식은 "가장 높은 값"만 저장한다(내려가지 않음).

import { MAINTAIN_BOX, LEARNED_BOX, isLearned, addDays, daysBetween } from './review.js';
import { LEVEL_MIN, LEVEL_MAX, MILESTONE_EVERY, PROMOTE_RATIO } from './grade.js';

// 익히면(상자 4 이상) 황금 벽돌, 상자 8은 빛나는 황금 벽돌 (ADR-0008, AC-44e1 · 44e2). 금색은 "금 간 돌"과 헷갈리지 않게 "황금"을 붙인다
export const SHAPE = { EMPTY: 'empty', ROUGH: 'rough', GOLD: 'gold', GILT: 'gilt', CRACKED: 'cracked' };
// 칸 모양의 글자 이름 (AC-44f: 색만으로 나누지 않는다)
export const SHAPE_NAMES = { empty: '빈칸', rough: '거친 돌', gold: '황금 벽돌', gilt: '빛나는 황금 벽돌', cracked: '금 간 돌' };
export const SHAPE_NOTES = {
  empty: '아직 안 푼 문제예요.',
  rough: '풀었지만 아직 확실하지 않아요.',
  gold: '익혔어요. 황금 벽돌을 놓았어요.',
  gilt: '오래 기억하고 있어요. 벽돌이 빛나요.',
  cracked: '착각이 남아 있어요. 서로 다른 두 날 확실하게 맞히면 보수돼요.',
};
// 등급 → 탑의 단 (AC-44c · 44d): 입문 = 기단, 기본 · 실무 · 심화 = 탑신 1 · 2 · 3층
export const TIER_NAMES = { 1: '기단', 2: '1층', 3: '2층', 4: '3층' };
export const LANTERN_SHOW_DAYS = 28;   // 내 탑의 청사초롱 줄, AC-44p (4주 검증과 같은 28일)
export const LANTERN_KEEP_DAYS = 60;   // 저장은 최근 60일만 (data-model 4장)

// 결과 뜻 1줄 (AC-44a · 44u). {언제} = 그 문제가 다시 나오는 실제 날. 복습 규칙(상자 · 계산식)은 쓰지 않는다(AC-71).
export function whenText(days) {
  if (!Number.isInteger(days) || days <= 0) return '곧';
  return days === 1 ? '내일' : `${days}일 뒤에`;
}
export function meaningFor(status, days) {
  const w = whenText(days);
  switch (status) {
    case 'known': return `확실하게 맞혔어요. 이 문제는 ${w} 다시 나와요. 맞힐수록 다시 나오는 날이 멀어져요.`;
    case 'shaky': return `맞혔지만 확신이 없었어요. 이 문제는 ${w} 다시 나와서 확실하게 만들어요.`;
    case 'confused': return `확신 없이 골랐는데 틀렸어요. 이 문제는 ${w} 다시 나와요.`;
    case 'misconception': return `확실하다고 골랐는데 틀렸어요. 찾은 착각은 고칠 수 있어요. 이 문제는 ${w} 다시 나와요.`;
    case 'unknown': return `모른다고 솔직하게 골랐어요. 정답을 봤으니 다음엔 달라요. 이 문제는 ${w} 다시 나와요.`;
    default: return '';
  }
}

// 풀던 중 응원 1줄 (AC-13f~13h, flows 14-3a): 헷갈림 · 착각 · 모름마다 2개 이상, 바로 전과 다른 문장
export const ENCOURAGE = {
  misconception: [
    '괜찮아요. 확신했다가 틀린 답은 정답을 보고 나면 오히려 더 잘 고쳐진대요.',
    '여기서 걸려서 다행이에요. 실제 코드였다면 찾기 어려운 버그였을 거예요.',
    '개발자들도 자주 걸리는 곳이에요. 이제 이 함정은 알아볼 수 있어요.',
  ],
  confused: [
    '헷갈린다고 솔직하게 고른 게 잘한 거예요. 다음에 다시 보면 훨씬 선명해져요.',
    '틀리면서 익힌 건 오래 남아요. 자세히 보기로 한 줄씩 따라가 볼까요?',
  ],
  unknown: [
    '모른다고 말하는 것도 실력이에요. 방금 정답을 봤으니 다음엔 달라요.',
    '처음 보는 건 모르는 게 당연해요. 오늘 한 번 본 것만으로도 한 걸음이에요.',
  ],
};
// last: 바로 전에 보여 준 문장, rand: 0 이상 1 미만 (시험에서 고정)
export function pickEncourage(status, last = null, rand = Math.random()) {
  const list = (ENCOURAGE[status] || []).filter((t) => t !== last);
  if (!list.length) return null;
  return list[Math.min(list.length - 1, Math.floor(rand * list.length))];
}

// ----- 칸 모양 (flows 14-1, AC-44e) -----
export function cellShape(rec) {
  if (!rec || !rec.status) return SHAPE.EMPTY;           // 기록이 없거나 아직 답한 적 없음
  if (rec.mis) return SHAPE.CRACKED;                      // 착각이 남아 있음
  if (rec.box >= MAINTAIN_BOX) return SHAPE.GILT;         // 상자 8: 빛나는 황금 벽돌 (AC-44e2)
  if (rec.box >= LEARNED_BOX) return SHAPE.GOLD;          // 상자 4~7 (익힘): 황금 벽돌 (AC-44e1)
  return SHAPE.ROUGH;
}
// 금 간 돌의 보수 반쯤: 서로 다른 날 1번 확실하게 맞힘 (AC-44q)
export const isHalfRepaired = (rec) => !!(rec && rec.mis && rec.mis.streak >= 1);

// 등급마다 한 단, 칸 순서는 problems.json 순서 (AC-44d)
export function towerTiers(problems, records) {
  const tiers = [];
  for (let level = LEVEL_MIN; level <= LEVEL_MAX; level++) {
    tiers.push({
      level,
      name: TIER_NAMES[level],
      cells: problems.filter((p) => p.level === level).map((p) => ({ id: p.id, shape: cellShape(records[p.id]), half: isHalfRepaired(records[p.id]) })),
    });
  }
  return tiers;
}
export function shapeCounts(tiers) {
  const c = { empty: 0, rough: 0, gold: 0, gilt: 0, cracked: 0 };
  for (const t of tiers) for (const cell of t.cells) c[cell.shape] += 1;
  return c;
}

// ----- 작은 장면 고르기 (flows 14-2, AC-44g · 44r · 44s) -----
const RANK = { empty: 0, rough: 1, gold: 2, gilt: 3 };
// before: 한 판 시작 때 기록, after: 끝 기록. 돌려주는 값: { kind, from, to }
// kind: repair · place-crack · place · crack · harden · gild · drop · half · shine
export function sceneFor(before, after) {
  const from = cellShape(before);
  const to = cellShape(after);
  const s = (kind) => ({ kind, from, to });
  if (to === SHAPE.EMPTY) return s('shine');                       // ①만 본 판 등 아직 답이 없으면 반짝임만
  if (from === SHAPE.CRACKED && to !== SHAPE.CRACKED) return s('repair');
  if (from === SHAPE.EMPTY && to === SHAPE.CRACKED) return s('place-crack');
  if (from === SHAPE.EMPTY) return s('place');
  if (to === SHAPE.CRACKED && from !== SHAPE.CRACKED) return s('crack');
  if (from !== SHAPE.CRACKED && to !== SHAPE.CRACKED) {
    if (RANK[to] > RANK[from]) return s(to === SHAPE.GILT ? 'gild' : 'harden');
    if (RANK[to] < RANK[from]) return s('drop');
  }
  if (to === SHAPE.CRACKED && !isHalfRepaired(before) && isHalfRepaired(after)) return s('half');
  return s('shine');
}

// 응원 1줄 (AC-44b) + 덧붙임 1줄. info: { tierName, filled, total, nextDays }
export function cheerFor(scene, info = {}) {
  const where = info.tierName && info.total ? `${info.tierName} ${info.filled} / ${info.total}칸` : '';
  switch (scene.kind) {
    case 'repair': return { cheer: '착각 하나를 고쳤어요. 금 간 돌을 보수했어요.', sub: '서로 다른 두 날 확실하게 맞혔어요.' };      // AC-44r
    case 'place-crack':
    case 'crack': return { cheer: '착각을 하나 찾았어요. 금 간 곳을 알면 고칠 수 있어요.', sub: '다른 날 두 번 확실하게 맞히면 보수돼요.' };
    case 'place': return { cheer: '새 돌을 하나 놓았어요.', sub: where };
    case 'harden': return { cheer: '익혔어요. 황금 벽돌을 놓았어요.', sub: where };
    case 'gild': return { cheer: '황금 벽돌이 빛나요. 오래 기억할 거예요.', sub: where };
    case 'drop': return { cheer: '돌이 조금 흔들렸어요. 다시 맞히면 돌아와요.', sub: '정답과 풀이를 봤으니 다음엔 달라요.' };    // AC-44s
    case 'half': return { cheer: '보수 반쯤 왔어요.', sub: '다른 날 한 번 더 확실하게 맞히면 고쳐져요.' };
    default: return { cheer: '복습 한 번이 쌓였어요.', sub: Number.isInteger(info.nextDays) && info.nextDays > 0 ? `다음 복습은 ${info.nextDays}일 뒤예요.` : '' };
  }
}
// 다음 복습까지 날 수 (응원 덧붙임용)
export const daysUntil = (day, rec) => (rec && rec.next_review_at ? daysBetween(day, rec.next_review_at) : null);

// ----- 장식 (flows 14-4, AC-44h~44k · 44p · 44t) -----
export function blankTower() {
  return { lantern_count: 0, lantern_days: [], bells: {}, caps: {}, done_at: null };
}
// 저장값이 깨져 있어도 쓸 수 있게 모양을 맞춘다 (flows 10장)
export function sanitizeTower(stored) {
  const t = blankTower();
  if (!stored || typeof stored !== 'object') return t;
  if (Number.isInteger(stored.lantern_count) && stored.lantern_count >= 0) t.lantern_count = stored.lantern_count;
  if (Array.isArray(stored.lantern_days)) t.lantern_days = stored.lantern_days.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (t.lantern_count < t.lantern_days.length) t.lantern_count = t.lantern_days.length;
  for (let lv = LEVEL_MIN; lv <= LEVEL_MAX; lv++) {
    const b = stored.bells && stored.bells[lv];
    if (Number.isInteger(b) && b > 0) t.bells[lv] = b;
    if (stored.caps && stored.caps[lv] === true) t.caps[lv] = true;
  }
  if (typeof stored.done_at === 'string') t.done_at = stored.done_at;
  return t;
}

// 한 판이 끝날 때 부른다. goalMet: 이번 판으로 오늘 단계가 하루 목표를 처음 넘었나.
// 돌려주는 값: { tower: 새로 저장할 값, added: { lantern, bells: [등급], caps: [등급], done } }
export function updateTower(stored, problems, records, { day, goalMet = false }) {
  const t = sanitizeTower(stored);
  const added = { lantern: false, bells: [], caps: [], done: false };

  if (goalMet && !t.lantern_days.includes(day)) {                 // 청사초롱: 하루 1개 (AC-44i)
    t.lantern_days = [...t.lantern_days, day].sort();
    const oldest = addDays(day, -(LANTERN_KEEP_DAYS - 1));
    t.lantern_days = t.lantern_days.filter((d) => d >= oldest);
    t.lantern_count += 1;
    added.lantern = true;
  }
  for (let lv = LEVEL_MIN; lv <= LEVEL_MAX; lv++) {
    const inLevel = problems.filter((p) => p.level === lv);
    const learned = inLevel.filter((p) => isLearned(records[p.id])).length;
    const bells = Math.floor(learned / MILESTONE_EVERY);            // 풍경: 이정표와 같은 기준 (AC-44j)
    if (bells > (t.bells[lv] || 0)) { t.bells[lv] = bells; added.bells.push(lv); }
    const need = Math.ceil(inLevel.length * PROMOTE_RATIO - 1e-9);  // 맨 위 돌: 80% (올림, grade.js와 같은 셈) (AC-44k)
    if (inLevel.length > 0 && learned >= need && !t.caps[lv]) { t.caps[lv] = true; added.caps.push(lv); }
  }
  const all = problems.map((p) => cellShape(records[p.id]));
  if (!t.done_at && all.length > 0 && all.every((s) => s === SHAPE.GOLD || s === SHAPE.GILT)) { t.done_at = day; added.done = true; }   // 상륜부: 모든 칸이 황금 벽돌 이상 (AC-44t)
  return { tower: t, added };
}
export const hasBigScene = (added) => !!(added && (added.lantern || added.bells.length || added.caps.length || added.done));   // AC-44h

// 큰 장면에 함께 보여 줄 글 (등급 이름은 탑의 단 이름으로)
export function bigLines(added, tower) {
  const lines = [];
  if (added.done) lines.push('황금탑을 완성했어요! 상륜부를 올렸어요.');
  for (const lv of added.caps) lines.push(`${TIER_NAMES[lv]}에 ${lv === 1 ? '갑석' : '지붕돌'}을 얹었어요.`);
  for (const lv of added.bells) lines.push(`${TIER_NAMES[lv]}에 풍경을 달았어요.`);
  if (added.lantern) lines.push(`오늘 목표를 채웠어요. 청사초롱 ${tower.lantern_count}번째를 켰어요!`);
  return lines;
}

// 최근 28일 청사초롱 줄: 오래된 날 → 오늘 순서로 켬 여부 (AC-44p)
export function lanternRow(tower, day, n = LANTERN_SHOW_DAYS) {
  const set = new Set(tower.lantern_days);
  return Array.from({ length: n }, (_, i) => { const d = addDays(day, i - (n - 1)); return { day: d, lit: set.has(d) }; });
}
