# 파이썬 연습 한 번 실행 (검사 도구 check_problems.mjs가 부른다). 브라우저와 같은 site/py/cm_run.py를 쓴다.
# 쓰는 법: python -I tools/py_run.py < {"src": "...", "names": [..] 또는 null, "line_map": [..] 또는 null}
# 결과: {"ok", "kind"?, "error"?, "out", "ms", "trace"?} (JSON 한 줄, 글자는 \u 이스케이프)
import importlib.util
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('cm_run', HERE.parent / 'site' / 'py' / 'cm_run.py')
cm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cm)

job = json.loads(sys.stdin.buffer.read().decode('utf-8'))
res = cm.cm_run(job['src'], job.get('names'), job.get('line_map'))
sys.stdout.write(json.dumps(res, ensure_ascii=True))
