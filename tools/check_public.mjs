#!/usr/bin/env node
// 공개 전 점검 — 저장소를 공개로 바꾸기 전, 그리고 배포 작업이 돌 때 돌린다.
// 근거: docs/adr/0005 3장 1번, docs/architecture.md 4-3a, 수용 기준 AC-86 · 87 · 88.
// 찾기는 도구, 결정은 사람, 막기는 배포 관문: 이 도구는 찾아서 제안만 하고, 파일과 Git 기록은 고치지 않는다(AC-87).
//
// 사용: node tools/check_public.mjs [--dir 저장소 경로] [--allow 허용 목록 경로] [--no-report]
// 끝 코드: 허용되지 않은 것 0개 → 0, 1개 이상 → 1 (배포 작업이 이 값을 보고 멈춘다, AC-88)

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SECRET_PATTERNS } from './check_problems.mjs'; // 실전 읽기 검사와 같은 비밀 값 모양 9가지

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 이보다 큰 파일은 글이 아니라고 보고 건너뛴다
const AUTHOR = '(커밋 작성자 이메일)';

const git = (dir, args) => execFileSync('git', ['-C', dir, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
const globalRe = (re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
const PATTERNS = SECRET_PATTERNS.map(([kind, re]) => [kind, globalRe(re)]);

// 글 한 줄에서 비밀 값 모양을 모두 찾는다
export function findInLine(text) {
  const out = [];
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) out.push({ kind, match: m[0] });
  }
  return out;
}

// ---- 허용 목록: 사용자가 승인한 것만 (data-model 1장 정본 표) ----
export function loadAllow(file) {
  if (!fs.existsSync(file)) return { allow: [], errors: [] };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = [];
  const allow = (data.allow || []).filter((a, i) => {
    const ok = (a.text || a.pattern || a.path || a.sha256) && a.why && a.approved;
    if (!ok) errors.push(`허용 목록 ${i + 1}번 항목에 무엇(text · pattern · path · sha256) · 왜(why) · 승인(approved)이 모두 있어야 합니다.`);
    return ok;
  });
  return { allow, errors };
}

// sha256: 값 자체를 허용 목록에 적으면 그 값이 다시 공개되므로, 지난 기록에만 남긴 값은 지문(해시)으로 허용한다
export const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

function isAllowed(allow, finding, where) {
  return allow.some((a) =>
    (a.text && a.text === finding.match) ||
    (a.sha256 && a.sha256 === sha256(finding.match)) ||
    (a.pattern && new RegExp(a.pattern).test(finding.match)) ||
    (a.path && where.path === a.path));
}

// ---- 저장소 전체 점검 (AC-86): 지금 파일 · 지난 커밋 전체 · 커밋 작성자 이메일 ----
export function scanRepo(dir, allow = []) {
  const found = new Map(); // kind + match → { kind, match, where[] }
  let allowedCount = 0;
  const add = (hit, where) => {
    if (isAllowed(allow, hit, where)) { allowedCount += 1; return; }
    const key = `${hit.kind}\u0000${hit.match}`;
    if (!found.has(key)) found.set(key, { ...hit, where: [] });
    found.get(key).where.push(where);
  };

  // 1) 지금 Git이 관리하는 파일
  for (const rel of git(dir, ['ls-files', '-z']).split('\u0000').filter(Boolean)) {
    const full = path.join(dir, rel);
    let buf;
    try { buf = fs.readFileSync(full); } catch { continue; } // 지운 뒤 아직 커밋 안 한 파일
    if (buf.length > MAX_FILE_BYTES || buf.includes(0)) continue; // 그림 등 글이 아닌 파일
    buf.toString('utf8').split(/\r?\n/).forEach((line, i) => {
      for (const hit of findInLine(line)) add(hit, { source: 'file', path: rel, line: i + 1 });
    });
  }

  // 2) 모든 브랜치의 지난 커밋에서 더해진 줄 (지금은 지웠어도 기록에 남은 것)
  let hasCommits = true;
  try { git(dir, ['rev-parse', '--verify', 'HEAD']); } catch { hasCommits = false; }
  if (hasCommits) {
    let commit = '';
    let file = '';
    for (const line of git(dir, ['log', '--all', '-p', '--no-color', '--no-ext-diff', '--format=%x01commit %H']).split('\n')) {
      if (line.startsWith('\u0001commit ')) { commit = line.slice(8, 15); continue; }
      if (line.startsWith('+++ ')) { file = line.startsWith('+++ b/') ? line.slice(6) : ''; continue; }
      if (line.startsWith('+') && file) {
        for (const hit of findInLine(line.slice(1))) add(hit, { source: 'history', path: file, commit });
      }
    }
    // 3) 커밋 작성자 · 커밋한 사람 이메일
    for (const email of new Set(git(dir, ['log', '--all', '--format=%ae%n%ce']).split('\n').filter(Boolean))) {
      add({ kind: '이메일 주소', match: email }, { source: 'author', path: AUTHOR });
    }
  }

  const findings = [...found.values()].map((f) => ({
    ...f,
    inFiles: f.where.some((w) => w.source === 'file'),
    suggestion: suggest(f),
  }));
  return { findings, allowedCount };
}

// 처리 방법 제안. 도구는 고치지 않는다 — 고르는 것은 사람 (AC-87)
function suggest(f) {
  if (f.where.every((w) => w.source === 'author')) {
    return /@users\.noreply\.github\.com$/.test(f.match)
      ? 'GitHub가 진짜 주소를 가려 주는 noreply 주소입니다. 공개해도 안전해 허용 목록에 넣기를 추천합니다.'
      : '커밋 작성자 이메일입니다. 공개해도 되면 허용 목록에 넣고, 아니면 지난 기록까지 바꿔야 합니다(되돌리기 어려움, 새 ADR).';
  }
  if (f.where.some((w) => w.source === 'file')) return '① 공개해도 되면 허용 목록에 넣기(사용자 승인) ② 지금 파일에서 지우기(지난 기록에는 남음) ③ 지난 기록까지 지우기(되돌리기 어려움, 새 ADR)';
  return '지금 파일에는 없고 지난 기록에만 있습니다. ① 공개해도 되면 허용 목록에 넣기 ② 지난 기록까지 지우기(되돌리기 어려움, 새 ADR)';
}

export function formatReport({ findings, allowedCount }, day) {
  const lines = [`# 공개 전 점검 보고서 (${day})`, '',
    `- 허용되지 않은 비밀 값 모양: **${findings.length}개** · 허용 목록으로 넘긴 것: ${allowedCount}건`,
    '- 이 도구는 파일과 Git 기록을 고치지 않습니다. 아래 제안 중 하나를 사람이 고릅니다.', ''];
  findings.forEach((f, i) => {
    const w = f.where;
    const files = [...new Set(w.filter((x) => x.source === 'file').map((x) => `${x.path}:${x.line}`))];
    const hist = w.filter((x) => x.source === 'history');
    lines.push(`## ${i + 1}. ${f.kind}: \`${f.match}\``, '');
    if (files.length) lines.push(`- 지금 파일: ${files.slice(0, 5).join(', ')}${files.length > 5 ? ` 외 ${files.length - 5}곳` : ''}`);
    if (hist.length) lines.push(`- 지난 기록: ${hist.length}번 (처음 본 곳 ${hist[hist.length - 1].commit} ${hist[hist.length - 1].path})`);
    if (w.some((x) => x.source === 'author')) lines.push('- 커밋 작성자 이메일');
    lines.push(`- 제안: ${f.suggestion}`, '');
  });
  if (!findings.length) lines.push('허용되지 않은 것이 없습니다. 공개 전환은 이 보고서를 사용자가 보고 승인한 뒤에 합니다(ADR-0005).');
  return lines.join('\n');
}

// ---- 명령줄 ----
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = path.resolve(arg('--dir', root));
  const { allow, errors } = loadAllow(arg('--allow', path.join(dir, 'tools/public_allow.json')));
  for (const e of errors) console.log(`✗ ${e}`);
  const result = scanRepo(dir, allow);
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const report = formatReport(result, day);
  console.log(report);
  if (!process.argv.includes('--no-report')) {
    const out = path.join(dir, 'pipeline/reports', `공개점검_${day}.md`); // Git 밖(.gitignore)
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, report + '\n');
    console.log(`\n보고서: ${out}`);
  }
  if (result.findings.length || errors.length) {
    console.log(`✗ 허용되지 않은 것 ${result.findings.length}개 — 공개 · 배포하지 마세요(AC-88).`);
    process.exit(1);
  }
  console.log('✓ 공개 점검 통과');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
