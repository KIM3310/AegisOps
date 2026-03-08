# AegisOps Service-Grade SPECKIT

작성일: 2026-03-08

## 1) 문제 정의

AegisOps는 기능 자체는 이미 강하다.

- 멀티모달 incident 분석
- structured report
- replay eval
- follow-up chat
- Workspace export

하지만 지금 상태에서는 리뷰어가 첫 화면과 API surface만 보고 다음을 즉시 이해하기 어렵다.

1. 이 서비스가 어떤 운영 모드로 돌아가는가
2. 어떤 입력/출력 계약을 보장하는가
3. 현재 실행 환경이 demo/static/live 중 무엇인가
4. replay eval 결과와 실제 분석 UX가 어떻게 연결되는가

즉, 기능은 있지만 `service posture`가 전면에 드러나지 않는다.

## 2) 이번 iteration 목표

이번 iteration은 AegisOps를 “기능이 많은 해커톤 앱”에서 “운영 가능한 incident copilot surface”로 보이게 만드는 1차 고도화다.

핵심 목표:

- 명시적 service meta surface 추가
- 명시적 report schema surface 추가
- pre-analysis 단계에서 operator readiness를 바로 보여주는 UI 추가
- 위 표면을 테스트와 README에서 추적 가능하게 만들기

## 3) S P E C K I T

### S (Scope)

이번 범위:

- backend:
  - `/api/meta`
  - `/api/schema/report`
  - health envelope links 확장
- frontend:
  - operator readiness card
  - static/demo/live posture 노출 강화
  - report contract 요약 노출
- tests:
  - meta endpoint
  - schema endpoint
  - static fallback fetch behavior
- docs:
  - README endpoint 목록 및 service-grade 설명 보강

이번 범위 제외:

- 전체 비주얼 리디자인
- Workspace export UX 재구성
- incident history 저장소 구조 변경
- full OpenAPI generation

### P (Principles)

- raw chain-of-thought는 노출하지 않는다.
- 대신 spec, decisions, contracts, acceptance criteria로 사고 과정을 남긴다.
- backend truth와 frontend messaging이 어긋나면 안 된다.
- static demo에서도 최대한 동일한 mental model을 유지한다.

### E (Execution)

1. service meta / report schema를 서버에서 생성
2. frontend static fallback에도 같은 shape 제공
3. operator readiness card를 입력 화면 상단에 배치
4. 테스트 추가
5. README에 새 API surface와 의도 반영

### C (Criteria)

PASS 기준:

- `/api/meta`가 현재 운영 모드, workflow, replay summary, report contract를 반환
- `/api/schema/report`가 required sections와 field guidance를 반환
- backend가 없을 때 frontend가 deterministic static fallback meta/schema를 제공
- 입력 전 화면에서 현재 모드, replay quality, input limits, report contract를 확인 가능
- 테스트/빌드 통과

### K (Keep)

- healthz는 lightweight ops envelope로 유지
- replay eval은 별도 score surface로 유지
- demo/static/live 3가지 사용자 경험을 하나의 mental model 아래 유지

### I (Improve)

다음 iteration 후보:

- JSON schema export + downloadable sample payload
- report citations / evidence trace section 강화
- operator walkthrough screenshots / video strip
- auth and Workspace export contract tests

### T (Trace)

이번 iteration에서 확인할 추적 포인트:

- spec file
- code diff
- test additions
- README 업데이트
- local build/test logs

## 4) Acceptance Questions

리뷰어가 다음 질문에 30초 안에 답할 수 있어야 한다.

- AegisOps는 정확히 무엇을 하는가?
- 지금 demo인가, live backend인가, static pages인가?
- 어떤 입력 제한이 있는가?
- 어떤 구조의 report를 보장하는가?
- replay eval이 실제 제품에 어떻게 연결되는가?

이번 작업은 이 5개 질문에 대한 답을 코드와 UI에서 직접 보이게 만드는 데 초점을 둔다.
