// 공개 전 점검 도구 시험 (AC-86 · 87, ADR-0005)
// 임시 폴더에 작은 Git 저장소를 만들어 돌린다. 이 파일 안에는 비밀 값 모양을 그대로 쓰지 않고
// 조각을 이어 만든다(그래야 이 시험 파일 자체가 공개 점검에 걸리지 않는다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scanRepo, loadAllow, findInLine, sha256 } from '../tools/check_public.mjs';

const j = (...parts) => parts.join('');
const MAIL = j('dev', '@', 'mail', '.', 'test');            // 지금 파일에 있는 이메일
const OLD_MAIL = j('old', '@', 'mail', '.', 'test');        // 지난 기록에만 있는 이메일
const KEY = j('sk', '-', 'a'.repeat(20));                   // 가짜 키
const AUTHOR = j('writer', '@', 'mail', '.', 'test');       // 커밋 작성자 이메일

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-public-'));
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', `user.name=t`, '-c', `user.email=${AUTHOR}`, '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.md'), `연락: ${OLD_MAIL}\n`);
  git('add', '-A'); git('commit', '-q', '-m', 'first');
  fs.writeFileSync(path.join(dir, 'a.md'), `연락: ${MAIL}\n`);           // 옛 주소는 지움 → 지난 기록에만 남음
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'tests', 'fake.txt'), `const key = "${KEY}"\n`);
  git('add', '-A'); git('commit', '-q', '-m', 'second');
  return { dir, git };
}
const matches = (r) => r.findings.map((f) => f.match).sort();

test('지금 파일 · 지난 기록에만 있는 것 · 커밋 작성자 이메일을 모두 찾는다 (AC-86)', () => {
  const { dir } = makeRepo();
  const r = scanRepo(dir, []);
  assert.deepEqual(matches(r), [AUTHOR, KEY, MAIL, OLD_MAIL].sort());
  const old = r.findings.find((f) => f.match === OLD_MAIL);
  assert.equal(old.inFiles, false);                              // 지금 파일에는 없고
  assert.ok(old.where.some((w) => w.source === 'history'));      // 지난 기록에서 찾음
  assert.ok(r.findings.find((f) => f.match === AUTHOR).where.every((w) => w.source === 'author'));
});

test('허용 목록(글 · 모양 · 경로)에 있는 것은 넘긴다', () => {
  const { dir } = makeRepo();
  const ok = { why: '시험', approved: '시험' };
  const r = scanRepo(dir, [{ text: MAIL, ...ok }, { pattern: '^old@', ...ok }, { path: 'tests/fake.txt', ...ok }, { pattern: '^writer@', ...ok }]);
  assert.deepEqual(r.findings, []);
  assert.ok(r.allowedCount >= 4);
});

test('지난 기록에만 남긴 값은 지문(sha256)으로 허용한다: 허용 목록에 값을 다시 적지 않는다', () => {
  const { dir } = makeRepo();
  const r = scanRepo(dir, [{ sha256: sha256(OLD_MAIL), why: '시험', approved: '시험' }]);
  assert.equal(r.findings.some((f) => f.match === OLD_MAIL), false);
  assert.ok(r.findings.some((f) => f.match === MAIL)); // 다른 값은 그대로 찾는다
});

test('점검 도구는 파일과 Git 기록을 고치지 않는다 (AC-87)', () => {
  const { dir, git } = makeRepo();
  const before = { head: git('rev-parse', 'HEAD'), status: git('status', '--porcelain'), log: git('log', '--all', '--format=%H') };
  scanRepo(dir, []);
  assert.deepEqual({ head: git('rev-parse', 'HEAD'), status: git('status', '--porcelain'), log: git('log', '--all', '--format=%H') }, before);
});

test('허용 목록 항목에 왜 · 승인이 빠지면 오류로 알린다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-allow-'));
  const file = path.join(dir, 'allow.json');
  fs.writeFileSync(file, JSON.stringify({ allow: [{ text: MAIL }] }));
  const { allow, errors } = loadAllow(file);
  assert.equal(allow.length, 0);
  assert.equal(errors.length, 1);
});

test('내 컴퓨터 주소(루프백)는 사설 IP로 보지 않고, 사설 IP는 찾는다', () => {
  assert.deepEqual(findInLine(j('http://', '127.0.0.1', ':8765/')), []);
  assert.equal(findInLine(j('host = "', '192.168', '.0.12"'))[0].kind, '사설 IP 주소');
});
