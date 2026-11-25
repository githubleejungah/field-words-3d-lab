# 파이썬 연습의 ① 한 줄 실행 장면(trace) 만들기: 상자 값 · 출력은 실제 실행으로 채우고, 설명(note)만 사람이 쓴다.
# 자바스크립트의 tools/build_trace.mjs와 같은 역할. 브라우저 표와 같은 site/py/cm_run.py를 쓴다.
# 쓰는 법(초안 스크립트 안에서):
#   bt = load_build_trace()  # 아래 함수
#   trace, original = bt.build_trace(code, ['이름', ...], {'0': '첫 줄 설명', '2#1': '3번 줄의 두 번째 실행 설명'})
# - notes 키: "줄"(0부터) 또는 "줄#몇번째"(같은 줄이 여러 번 실행될 때, 0부터).
import importlib.util
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('cm_run', HERE.parent / 'site' / 'py' / 'cm_run.py')
cm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cm)


def build_trace(code, names, notes):
    res = cm.cm_run('\n'.join(code), names)
    if not res['ok']:
        raise RuntimeError(f"실행 실패: {res['error']}")
    seen = {}
    trace = []
    for r in res['trace']:
        occ = seen[r['line']] = seen.get(r['line'], -1) + 1
        note = notes.get(f"{r['line']}#{occ}", notes.get(str(r['line'])))
        if not note:
            raise RuntimeError(f"설명 없음: {r['line'] + 1}번 줄 ({occ + 1}번째)")
        trace.append({'line': r['line'], 'vars': r['vars'], 'out': r['out'], 'note': note})
    return trace, res['out']
