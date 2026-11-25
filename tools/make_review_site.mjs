// 쓰는 법: node tools/make_review_site.mjs → http://127.0.0.1:8765/field-words-3d-lab/pipeline/reports/review-site/#/review
// 검토용 사본 만들기: site/를 pipeline/reports/review-site/(Git 밖)로 복사하고, 후보 문제를 붙이고,
// 사본의 app.js에만 "#/review" 목록과 "#/try/<id>/<가릴 줄>/<v|i>" 바로 풀기 화면을 더한다. 저장소 파일은 바꾸지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = `${ROOT}/pipeline/reports/review-site`;
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(`${ROOT}/site`, OUT, { recursive: true });

const data = JSON.parse(fs.readFileSync(`${ROOT}/site/data/problems.json`, 'utf8'));
const cand = JSON.parse(fs.readFileSync(`${ROOT}/docs/candidates/problems-candidates.json`, 'utf8'));
data.problems = [...data.problems, ...cand.problems];
fs.writeFileSync(`${OUT}/data/problems.json`, JSON.stringify(data, null, 2));
// 파이썬 연습 후보(docs/candidates/python-candidates.json)도 사본의 data/python.json 뒤에 붙인다
const pyFile = `${ROOT}/site/data/python.json`;
const pyData = fs.existsSync(pyFile) ? JSON.parse(fs.readFileSync(pyFile, 'utf8')) : { schema_version: '1.0', problems: [] };
const pyCandFile = `${ROOT}/docs/candidates/python-candidates.json`;
const pyCand = fs.existsSync(pyCandFile) ? JSON.parse(fs.readFileSync(pyCandFile, 'utf8')).problems || [] : [];
pyData.problems = [...pyData.problems, ...pyCand];
fs.writeFileSync(`${OUT}/data/python.json`, JSON.stringify(pyData, null, 2));
const ids = [...cand.problems.map((p) => p.id), ...pyCand.map((p) => p.id)];

const appFile = `${OUT}/js/app.js`;
let s = fs.readFileSync(appFile, 'utf8').split('\r\n').join('\n'); // 줄 끝을 맞춘다(Git이 CRLF로 바꿨을 수 있음)
const rep = (o, n) => { if (s.split(o).length !== 2) throw new Error('not found: ' + o.slice(0, 60)); s = s.replace(o, n); };
rep("  else home();\n  updateTodayBar();\n}",
  "  else if (hash === '#/review') reviewList();\n" +
  "  else if (hash.startsWith('#/try/')) { const [, , id, k, m] = hash.split('/'); playTry(decodeURIComponent(id), k, m); }\n" +
  "  else home();\n  updateTodayBar();\n}\n\n" +
  "// ---------- 검토용 사본에만 있는 화면 (저장소 사이트에는 없음) ----------\n" +
  `const CANDIDATES = ${JSON.stringify(ids)};\n` +
  "function reviewList() {\n" +
  "  const rows = CANDIDATES.map((id) => {\n" +
  "    const p = state.byId.get(id) || state.py.byId.get(id);\n" +
  "    if (!p) return h('p', { class: 'card' }, `${id}: 모양 검사에 걸려 빠짐`);\n" +
  "    const t = glossTerm(p);\n" +
  "    return h('section', { class: 'card' },\n" +
  "      h('div', { class: 'meta' }, h('span', { class: 'lv' }, G.LEVEL_NAMES[p.level]), t ? h('span', { class: 'term', lang: 'en' }, t.term_en) : null, h('span', { class: 'muted' }, id)),\n" +
  "      h('div', { class: 'row' }, ...[0, 1].map((k) => btn(`①② ${p.masks[k].line + 1}번 줄 가리기`, () => go(`#/try/${id}/${k}/v`), 'btn small')),\n" +
  "        ...[0, 1].map((k) => btn(`③ ${p.masks[k].line + 1}번 줄`, () => go(`#/try/${id}/${k}/i`), 'btn ghost small'))));\n" +
  "  });\n" +
  "  show(h('section', { class: 'card' }, h('h2', {}, `검토용: 후보 문제 ${CANDIDATES.length}개`),\n" +
  "    h('p', { class: 'muted' }, '저장소 사이트와 따로 만든 검토용 사본이에요. 여기서 푼 기록은 이 주소에만 남아요. 다 풀면 [처음으로]를 누르면 이 목록으로 돌아와요.')), ...rows);\n" +
  "}\n" +
  "function playTry(id, k, m) {\n" +
  "  const p = state.byId.get(id) || state.py.byId.get(id);\n" +
  "  if (!p) { go('#/review'); return; }\n" +
  "  const py = p.lang === 'python';\n" +
  "  if (py && !pyConsent() && !state.py.later) { pyConsentScreen(() => playTry(id, k, m)); return; }\n" +
  "  if (py && pyConsent() === PY.CONSENT_ON) PR.start();\n" +
  "  const ctx = context();\n" +
  "  const stages = m === 'i' ? [R.STAGE.INTERPRET] : [R.STAGE.VIEW, R.STAGE.MASK];\n" +
  "  state.round = { py, item: { id, kind: py ? 'again' : 'new', stages, mask: Number(k) || 0 }, p, ctx: py ? { day: ctx.day, records: {} } : ctx, stageIdx: 0, rec: null, answers: [], banner: null, helpOpen: false, helpTab: 'faq', locked: false };\n" +
  "  renderStage();\n" +
  "}");
s = s.split("btn('처음으로', () => go('#/'),").join("btn('처음으로', () => go('#/review'),"); // 끝 화면(자바스크립트 · 파이썬) 모두
fs.writeFileSync(appFile, s);
// 옛 파일이 브라우저에 남아 옛 후보 목록이 보이지 않게: 데이터는 늘 새로 받고, js 파일 주소에 만든 시각을 붙인다
const V = Date.now();
s = s.split("fetch('data/problems.json')").join("fetch('data/problems.json', { cache: 'no-store' })");
s = s.split("fetch('data/python.json')").join("fetch('data/python.json', { cache: 'no-store' })");
fs.writeFileSync(appFile, s);
for (const f of fs.readdirSync(`${OUT}/js`).filter((x) => x.endsWith('.js'))) {
  const fp = `${OUT}/js/${f}`;
  const t = fs.readFileSync(fp, 'utf8').replace(/(from\s+'\.\/[\w-]+\.js)'/g, `$1?v=${V}'`);
  fs.writeFileSync(fp, t);
}
const html = `${OUT}/index.html`;
fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('<title>', '<title>[검토용] ').replace(/(js\/app\.js)/, `$1?v=${V}`).replace(/(css\/style\.css)/, `$1?v=${V}`));
console.log('ok', path.relative(ROOT, OUT), 'candidates', ids.length);
