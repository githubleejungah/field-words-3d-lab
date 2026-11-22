# 필드워드 코드 해석 게임 — "코드 가려 보기"

코드 한 줄을 가리고, 무엇이 달라질지 먼저 맞혀 본 뒤, 가린 코드를 실제로 실행해 확인하며 **코드를 읽는 힘**을 키우는 게임입니다. FDE 실무 용어 앱 [필드워드](https://githubleejungah.github.io/field-words/)에 붙이는 것을 목표로 합니다.

- 지금 상태: **시제품 만드는 중**. 설계 승인(2026-11-22) 뒤 문제 2개 · 문제 검사 도구 · 화면 없는 규칙 코드(복습 상자 · 착각 · 승급 · 하루 계획)를 만들었습니다. 화면은 아직입니다.
- 비용: 사용자 · 개발자 모두 0원. 서버 없이 브라우저에서만 돌아가는 정적 사이트로 만듭니다.

## 게임 한 판

| 단계 | 하는 일 |
|---|---|
| ① 해석 보기 | 줄마다 우리말 풀이가 붙은 코드와 실행 장면을 따라가 봄 |
| ② 가려 보기 | 한 줄을 가리고 출력 예측 → 확신도 → 실제 실행 → 원래 출력과 비교 |
| ③ 해석 고르기 | 가린 줄이 하는 일을 떠올린 뒤, 착각을 진단하는 보기 중에서 고름 |

처음 보는 코드는 ①부터, 이미 본 코드는 ②부터 시작합니다. 근거와 자세한 규칙은 [요구 문서](docs/requirements.md)에 있습니다.

## 문서 목록

| 문서 | 위치 | 상태 |
|---|---|---|
| README | `README.md` | 작성 |
| 작업 규칙 | [CLAUDE.md](CLAUDE.md) | 작성 |
| 요구 | [docs/requirements.md](docs/requirements.md) | 인터뷰 끝 · 수용 기준 88개 확인(2026-11-22) |
| 아키텍처 | [docs/architecture.md](docs/architecture.md) | 승인(2026-11-22) |
| 데이터 설계 | [docs/data-model.md](docs/data-model.md) | 승인(2026-11-22) |
| 흐름 설계 | [docs/flows.md](docs/flows.md) | 승인(2026-11-22) |
| 설계 결정 기록(ADR) | [docs/adr/](docs/adr/) | 0001 · 0002 예제 실행 · 0003 질문 자동 정리, 모두 채택 |
| 예시 화면(시안) | [docs/mockups/code-mask-preview.html](docs/mockups/code-mask-preview.html) | 학습자 화면만: 필드워드 등급 화면 3장 · 게임 한 판(규칙은 요구 문서에) |
| 필드워드 넘김 문서 | [docs/handoff/](docs/handoff/) | 필드워드 계정에 보낼 요청 목록(정리 끝) |

## 연락처

이메일: [veryfar@naver.com](mailto:veryfar@naver.com)
