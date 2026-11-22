#!/usr/bin/env node
// 문제 데이터 검사 도구 — 커밋 전에 개발자 PC에서 돌린다.
// 규칙 출처: docs/data-model.md 2-2 · 2-3, 수용 기준 AC-06~13 · AC-36 · AC-66 · AC-67.
// 필드워드 용어 사전은 읽기만 한다(필드워드 저장소를 고치지 않는다).
//
// 사용: node tools/check_problems.mjs [--problems 경로] [--words 경로] [--glossary 경로]

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---- 규칙 숫자 (요구 문서의 숫자는 설명용 사본, 바꾸면 문서도 같이 고친다) ----
export const RUN_LIMIT_MS = 1000;          // AC-67 실행 상한 1초 (추론, AS-2)
export const CODE_MIN_LINES = 3;           // AC-08
export const CODE_MAX_LINES = 10;          // AC-08
export const MASKS_PER_PROBLEM = 2;        // AC-10
export const OPTIONS_PER_QUIZ = 4;         // AC-12
export const LEVEL_MIN = 1;                // A10 등급 1~4
export const LEVEL_MAX = 4;
export const PROTOTYPE_PROBLEMS = 8;       // AC-74 (지금은 경고만)
export const PLAY_VALUE_MAX_CHARS = 20;    // 바꿔 보기 값은 짧은 글자만 (data-model 2-2)

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PLAY_VALUE_RE = /^[0-9A-Za-z가-힣 ._-]+$/;

// ---- 출력 글자 규칙 (data-model 2-3): 글자는 그대로, 그 밖은 JSON, 띄어쓰기 하나로 잇기 ----
export function formatArgs(args) {
  return args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
}

// ---- 코드 실행: 새 vm 맥락, console.log만 둔다, 1초 상한 ----
export function runCode(lines, limitMs = RUN_LIMIT_MS) {
  const out = [];
  const context = vm.createContext({ console: { log: (...a) => out.push(formatArgs(a)) } });
  let script;
  try {
    script = new vm.Script(lines.join('\n'), { filename: 'problem.js' });
  } catch (e) {
    return { ok: false, kind: 'syntax', error: String(e && e.message), out, ms: 0 };
  }
  const t0 = performance.now();
  try {
    script.runInContext(context, { timeout: limitMs });
  } catch (e) {
    const ms = performance.now() - t0;
    const kind = e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? 'timeout' : 'runtime';
    return { ok: false, kind, error: String(e && e.message), out, ms };
  }
  return { ok: true, out, ms: performance.now() - t0 };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isInt = (n) => Number.isInteger(n);
const KIND_KO = { syntax: '문법 오류', runtime: '실행 중 오류', timeout: `${RUN_LIMIT_MS}ms 상한 넘음` };

// ---- 검사 본체 ----
// data: problems.json 내용, words: words.json 내용, glossary: Map(용어 id → 등급) 또는 null(용어 검사 건너뜀)
export function checkProblems(data, words, glossary) {
  const errors = [];
  const warnings = [];
  const runs = [];
  const err = (id, rule, msg) => errors.push({ id, rule, msg });
  const run = (lines) => {
    const r = runCode(lines);
    runs.push(r.ms);
    return r;
  };

  const problems = Array.isArray(data && data.problems) ? data.problems : null;
  if (!problems) {
    err('-', 'file-shape', 'problems.json에 problems 목록이 없습니다.');
    return { errors, warnings, runs };
  }
  if (data.schema_version !== '1.0') err('-', 'schema-version', `schema_version은 "1.0"이어야 합니다(지금 ${data.schema_version}).`);
  const wordTable = (words && words.words) || {};

  const ids = new Set();
  for (const [i, p] of problems.entries()) {
    const id = p && typeof p.id === 'string' ? p.id : `#${i}`;
    if (!ID_RE.test(p.id || '')) err(id, 'id-format', 'id는 영어 소문자 · 숫자 · 하이픈만 씁니다.');
    if (ids.has(p.id)) err(id, 'id-dup', 'id가 겹칩니다.');
    ids.add(p.id);
  }

  for (const [i, p] of problems.entries()) {
    const id = p && typeof p.id === 'string' ? p.id : `#${i}`;
    const code = p.code;
    const n = Array.isArray(code) ? code.length : 0;
    const inRange = (line) => isInt(line) && line >= 0 && line < n;

    // 언어 · 용어 · 등급 (AC-06 · 07 · 09)
    if (p.lang !== 'javascript') err(id, 'lang', 'lang은 "javascript"여야 합니다(AC-06).');
    if (!Array.isArray(p.terms) || p.terms.length < 1) err(id, 'terms-empty', '필드워드 용어를 1개 이상 연결해야 합니다(AC-07).');
    if (!isInt(p.code_level) || p.code_level < LEVEL_MIN || p.code_level > LEVEL_MAX) err(id, 'code-level', `code_level은 ${LEVEL_MIN}~${LEVEL_MAX}입니다.`);
    if (glossary && Array.isArray(p.terms)) {
      const levels = [];
      for (const t of p.terms) {
        if (!glossary.has(t)) err(id, 'term-unknown', `필드워드에 없는 용어입니다: ${t}`);
        else levels.push(glossary.get(t));
      }
      if (levels.length === p.terms.length && isInt(p.code_level)) {
        const want = Math.max(p.code_level, ...levels);
        if (p.level !== want) err(id, 'level', `level은 max(용어 등급 ${levels.join(',')}, code_level ${p.code_level}) = ${want}이어야 합니다(지금 ${p.level}, AC-09).`);
      }
    } else if (isInt(p.code_level) && !(isInt(p.level) && p.level >= p.code_level && p.level <= LEVEL_MAX)) {
      err(id, 'level', 'level이 code_level보다 낮거나 범위 밖입니다.');
    }

    // 선행 문제 (AC-36)
    if (!Array.isArray(p.prereq)) err(id, 'prereq-shape', 'prereq는 목록이어야 합니다(없으면 []).');
    else for (const q of p.prereq) {
      if (q === p.id) err(id, 'prereq-self', '자기 자신을 선행 문제로 둘 수 없습니다.');
      else if (!ids.has(q)) err(id, 'prereq-unknown', `없는 선행 문제입니다: ${q}`);
    }

    // 코드 줄 수 (AC-08)
    if (!Array.isArray(code) || code.some((l) => typeof l !== 'string')) {
      err(id, 'code-shape', 'code는 글자 줄 목록이어야 합니다.');
      continue;
    }
    if (n < CODE_MIN_LINES || n > CODE_MAX_LINES) err(id, 'code-lines', `code는 ${CODE_MIN_LINES}~${CODE_MAX_LINES}줄입니다(지금 ${n}줄, AC-08).`);
    for (const key of ['explain', 'ko']) {
      if (!Array.isArray(p[key]) || p[key].length !== n) err(id, `${key}-lines`, `${key}는 code와 줄 수가 같아야 합니다(code ${n}줄).`);
    }

    // 덩어리 이름표 (AC-55)
    if (!Array.isArray(p.labels) || p.labels.length < 1) err(id, 'labels', '덩어리 이름표가 1개 이상 있어야 합니다(AC-55).');
    else {
      let prevTo = -1;
      for (const l of p.labels) {
        if (!inRange(l.from) || !inRange(l.to) || l.from > l.to) err(id, 'label-range', `이름표 범위가 잘못됐습니다: ${l.from}~${l.to}`);
        else if (l.from <= prevTo) err(id, 'label-overlap', `이름표가 겹치거나 순서가 뒤바뀌었습니다: ${l.from}~${l.to}`);
        if (!l.text) err(id, 'label-text', '이름표 글이 비었습니다.');
        if (isInt(l.to)) prevTo = Math.max(prevTo, l.to);
      }
    }

    // 낱말 (words.json에 있는 것만)
    for (const w of p.words || []) if (!wordTable[w]) err(id, 'word-unknown', `words.json에 없는 낱말입니다: ${w}`);

    // 원래 코드 실행 · 저장 출력 (data-model 2-2)
    const orig = run(code);
    if (!orig.ok) {
      err(id, 'run-original', `원래 코드가 실행되지 않습니다(${KIND_KO[orig.kind]}: ${orig.error}).`);
    } else if (!p.outputs || !same(p.outputs.original, orig.out)) {
      err(id, 'output-original', `저장 출력이 실제와 다릅니다. 실제: ${JSON.stringify(orig.out)}`);
    }

    // 한 줄 실행 장면: 마지막 out = 저장 출력
    if (!Array.isArray(p.trace) || p.trace.length < 1) err(id, 'trace-empty', '한 줄 실행 장면(trace)이 없습니다.');
    else {
      for (const s of p.trace) if (!inRange(s.line)) err(id, 'trace-line', `trace의 줄 번호가 범위 밖입니다: ${s.line}`);
      const last = p.trace[p.trace.length - 1];
      if (p.outputs && !same(last.out, p.outputs.original)) err(id, 'trace-output', 'trace 마지막 장면의 out이 저장 출력과 다릅니다.');
    }

    // 가릴 줄 (AC-10 · 11) · 보기 (AC-12 · 13)
    if (!Array.isArray(p.masks) || p.masks.length !== MASKS_PER_PROBLEM) {
      err(id, 'mask-count', `가릴 줄 후보는 정확히 ${MASKS_PER_PROBLEM}개입니다(AC-10).`);
    }
    const maskLines = new Set();
    for (const [k, m] of (p.masks || []).entries()) {
      const tag = `masks[${k}]`;
      if (!inRange(m.line)) { err(id, 'mask-line', `${tag} 줄 번호가 범위 밖입니다: ${m.line}`); continue; }
      if (maskLines.has(m.line)) err(id, 'mask-dup', `${tag} 같은 줄을 두 번 가립니다: ${m.line}`);
      maskLines.add(m.line);
      const masked = run(code.filter((_, j) => j !== m.line));
      if (!masked.ok) {
        err(id, `mask-${masked.kind}`, `${tag} ${m.line + 1}번 줄을 지우면 ${KIND_KO[masked.kind]}가 납니다(AC-11): ${masked.error}`);
      } else {
        if (orig.ok && same(masked.out, orig.out)) err(id, 'mask-same-output', `${tag} ${m.line + 1}번 줄을 지워도 출력이 같습니다(AC-11).`);
        if (!same(m.output, masked.out)) err(id, 'mask-output', `${tag} 저장 출력이 실제와 다릅니다. 실제: ${JSON.stringify(masked.out)}`);
      }
      for (const quiz of ['predict', 'interpret']) checkOptions(id, `${tag}.${quiz}`, m[quiz], err);
    }

    // 자주 묻는 질문: 줄 번호(0부터)별
    for (const [key, list] of Object.entries(p.faq || {})) {
      if (!/^\d+$/.test(key) || !inRange(Number(key))) err(id, 'faq-line', `faq 줄 번호가 범위 밖입니다: ${key}`);
      for (const f of Array.isArray(list) ? list : []) if (!f.q || !f.a) err(id, 'faq-entry', `faq ${key}: q와 a가 모두 있어야 합니다.`);
    }

    // 바꿔 보기 (AC-52): 정해 둔 칸 · 값만, 값마다 1초 안에 끝나는지
    if (p.play) {
      for (const [k, s] of (p.play.slots || []).entries()) {
        const tag = `play.slots[${k}]`;
        if (!inRange(s.line)) { err(id, 'play-line', `${tag} 줄 번호가 범위 밖입니다.`); continue; }
        const hits = code[s.line].split(s.token).length - 1;
        if (!s.token || hits !== 1) { err(id, 'play-token', `${tag} 바꿀 글자 "${s.token}"가 ${s.line + 1}번 줄에 정확히 1번 있어야 합니다(지금 ${hits}번).`); continue; }
        if (!Array.isArray(s.values) || s.values.length < 1) { err(id, 'play-values', `${tag} 고를 값이 없습니다.`); continue; }
        for (const v of s.values) {
          if (typeof v !== 'string' || v.length > PLAY_VALUE_MAX_CHARS || !PLAY_VALUE_RE.test(v)) {
            err(id, 'play-value', `${tag} 값은 ${PLAY_VALUE_MAX_CHARS}자 이하의 숫자 · 짧은 글자만 됩니다: ${JSON.stringify(v)}`);
            continue;
          }
          const changed = code.map((l, j) => (j === s.line ? l.replace(s.token, v) : l));
          const r = run(changed);
          if (!r.ok) err(id, `play-${r.kind}`, `${tag} 값 ${v}로 바꾸면 ${KIND_KO[r.kind]}가 납니다: ${r.error}`);
        }
      }
    }
  }

  // 선행 문제 고리 (A → B → A)
  const byId = new Map(problems.map((p) => [p.id, p]));
  const state = new Map(); // 1 방문 중, 2 끝
  const visit = (pid, trail) => {
    if (state.get(pid) === 2) return;
    if (state.get(pid) === 1) { err(pid, 'prereq-cycle', `선행 문제가 고리를 이룹니다: ${[...trail, pid].join(' → ')}`); return; }
    state.set(pid, 1);
    for (const q of (byId.get(pid) && byId.get(pid).prereq) || []) if (byId.has(q)) visit(q, [...trail, pid]);
    state.set(pid, 2);
  };
  for (const p of problems) visit(p.id, []);

  // 낱말 사전의 용어 링크 (AC-51)
  if (glossary) for (const [w, v] of Object.entries(wordTable)) {
    if (v.term && !glossary.has(v.term)) err(`words.json:${w}`, 'word-term-unknown', `필드워드에 없는 용어 링크입니다: ${v.term}`);
  }

  if (problems.length < PROTOTYPE_PROBLEMS) warnings.push(`문제 ${problems.length}개 — 첫 시제품 목표는 ${PROTOTYPE_PROBLEMS}개입니다(AC-74).`);
  return { errors, warnings, runs };
}

function checkOptions(id, tag, quiz, err) {
  const opts = quiz && quiz.options;
  if (!Array.isArray(opts) || opts.length !== OPTIONS_PER_QUIZ) {
    err(id, 'options-count', `${tag} 보기는 정확히 ${OPTIONS_PER_QUIZ}개입니다(AC-12).`);
    return;
  }
  const correct = opts.filter((o) => o.correct === true).length;
  if (correct !== 1) err(id, 'options-correct', `${tag} 정답은 정확히 1개여야 합니다(지금 ${correct}개).`);
  const texts = new Set();
  for (const o of opts) {
    if (!o.text) err(id, 'option-text', `${tag} 보기 글이 비었습니다.`);
    if (texts.has(o.text)) err(id, 'option-dup', `${tag} 같은 보기가 두 번 있습니다: ${o.text}`);
    texts.add(o.text);
    if (o.correct !== true && !o.why) err(id, 'option-why', `${tag} 틀린 보기 "${o.text}"에 착각 풀이(why)가 없습니다(AC-13).`);
  }
}

// ---- 필드워드 용어 사전 읽기 (읽기만) ----
export function loadGlossary(file) {
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Map(g.terms.map((t) => [t.id, t.level]));
}

// ---- 명령줄 ----
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const problemsFile = arg('--problems', path.join(root, 'site/data/problems.json'));
  const wordsFile = arg('--words', path.join(root, 'site/data/words.json'));
  const glossaryFile = arg('--glossary', path.join(root, '../field-words/site/data/glossary.json'));

  let glossary = null;
  if (fs.existsSync(glossaryFile)) glossary = loadGlossary(glossaryFile);
  else console.log(`! 필드워드 용어 사전을 찾지 못해 용어 · 등급 검사를 건너뜁니다: ${glossaryFile}`);

  const data = JSON.parse(fs.readFileSync(problemsFile, 'utf8'));
  const words = JSON.parse(fs.readFileSync(wordsFile, 'utf8'));
  const { errors, warnings, runs } = checkProblems(data, words, glossary);

  for (const w of warnings) console.log(`! ${w}`);
  for (const e of errors) console.log(`✗ [${e.id}] ${e.msg} (${e.rule})`);
  const maxMs = runs.length ? Math.max(...runs) : 0;
  console.log(`실행 ${runs.length}번, 가장 긴 실행 ${maxMs.toFixed(1)}ms (상한 ${RUN_LIMIT_MS}ms, AS-2)`);
  if (errors.length) {
    console.log(`✗ 오류 ${errors.length}건 — 커밋하지 마세요.`);
    process.exit(1);
  }
  console.log(`✓ 문제 ${data.problems.length}개 모두 통과`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
