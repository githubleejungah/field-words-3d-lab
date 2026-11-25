# 코드 가려 보기 — 파이썬 연습 실행 도우미 (브라우저 Pyodide와 개발자 PC 검사 도구가 함께 쓴다)
# 근거: docs/flows.md 15장, docs/architecture.md 4-1 · 4-3, 수용 기준 AC-111~114, ADR-0007.
# - 출력: print가 낸 줄을 모은다(마지막 빈 줄은 뺀다).
# - 줄마다 상자 값 표(AC-113): sys.settrace로 "그 줄이 끝난 뒤"의 값을 모은다.
#   같은 함수 안의 다음 줄로 넘어가거나 함수가 끝날 때 앞 줄을 기록한다(자바스크립트 표와 같은 뜻).
# - 표준 라이브러리만 쓴다.
import io
import sys
import time

FILENAME = '<연습>'
ROW_LIMIT = 200  # 표 줄 수 상한 (자바스크립트 runner.js와 같음)


def _fmt(v):
    if callable(v):
        return '함수'
    return repr(v)


def cm_run(src, names=None, line_map=None):
    """src: 코드 글자. names: 표에 모을 이름(None이면 표를 만들지 않음).
    line_map: 실행한 코드의 줄(0부터) → 원래 코드의 줄 번호. 가린 줄을 뺀 코드에서 쓴다."""
    out = io.StringIO()
    rows = []

    def out_lines():
        return out.getvalue().split('\n')[:-1]

    try:
        code = compile(src, FILENAME, 'exec')
    except SyntaxError as e:
        return {'ok': False, 'kind': 'syntax', 'error': f'{type(e).__name__}: {e.msg}', 'out': [], 'ms': 0}

    pending = {}

    def snap(frame):
        vals = {}
        for n in names:
            if n in frame.f_locals:
                vals[n] = _fmt(frame.f_locals[n])
            elif n in frame.f_globals:
                vals[n] = _fmt(frame.f_globals[n])
        return vals

    def flush(frame):
        ln = pending.pop(id(frame), None)
        if ln is not None and len(rows) < ROW_LIMIT:
            i = ln - 1
            rows.append({'line': line_map[i] if line_map else i, 'vars': snap(frame), 'out': out_lines()})

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != FILENAME:
            return None
        if event == 'line':
            flush(frame)
            pending[id(frame)] = frame.f_lineno
        elif event == 'return':
            flush(frame)
        return tracer

    g = {'__name__': '__main__'}
    old = sys.stdout
    sys.stdout = out
    t0 = time.perf_counter()
    try:
        if names is not None:
            sys.settrace(tracer)
        exec(code, g)
    except Exception as e:  # 실행 중 오류
        sys.settrace(None)
        sys.stdout = old
        return {'ok': False, 'kind': 'runtime', 'error': f'{type(e).__name__}: {e}', 'out': out_lines(), 'ms': (time.perf_counter() - t0) * 1000}
    finally:
        sys.settrace(None)
        sys.stdout = old
    res = {'ok': True, 'out': out_lines(), 'ms': (time.perf_counter() - t0) * 1000}
    if names is not None:
        res['trace'] = rows
    return res
