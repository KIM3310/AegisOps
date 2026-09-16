# AegisOps

**장애의 근거를 모으고, 대응 계획을 검토하고, 다음 담당자에게 넘기는 워크벤치.**

AegisOps는 로그와 모니터링 이미지를 분석 보고서로 정리하고, 원본 근거와 출처를 확인한 담당자가 대응 계획을 검토하도록 돕는 React·TypeScript 애플리케이션입니다. 공공기관의 소규모 운영팀을 초기 고객 가설로 삼습니다.

현재는 **합성 자료로 검증하는 로컬 프로토타입**입니다. 실제 기관 자료 연동, 현장 실증, 보안인증, 장애 복구 시간 개선을 달성한 제품으로 표현하지 않습니다. 모델 분석은 가설이며, 계획 검토 완료는 작업 실행 승인이나 장애 해결이 아닙니다.

[한국어 프로젝트 소개](docs/PROJECT_INTRODUCTION.ko.md) · [8주 실증 계획](docs/PILOT_PLAN.ko.md) · [기존 공개 데모](https://aegisops-ai-incident-doctor.pages.dev/) · [CI](https://github.com/KIM3310/AegisOps/actions/workflows/ci.yml) · [MIT](LICENSE)

## 핵심 흐름

```text
로그·이미지 → 분석 보고서 (가설)
                  ↓ 운영자가 스냅샷 제출
정확한 로그 줄 + 버전·해시가 있는 합성 출처
                  ↓
초안 → 담당자 검토 → 검토 완료 또는 보완 요청
                  ↓
서버에 저장된 상태로 한글 인수인계 내보내기
```

| 기능 | 구현 경계 |
| --- | --- |
| 근거 연결 | 원본 로그의 줄 번호·인용과 합성 매뉴얼의 버전·인용·해시를 함께 표시 |
| 명시적 검토 | 점검 계획별 확인과 메모가 필요. 근거 부족, 잘못된 전이, 오래된 revision은 거부 |
| 저장과 재개 | 서버가 검토 상태를 관리. 다시 열 때 저장값을 검증하며 브라우저의 완료 표시를 신뢰하지 않음 |
| 보안 이벤트 입력 | 로컬 JSONL을 전부 검증한 뒤 변환. 잘못된 행·건수·크기 초과는 전체 거부 |
| 한글 인수인계 | Markdown, 전체 JSON, Hancom 텍스트 치환 JSON. 실제 HWP/HWPX 생성은 미구현 |
| 인증 경계 | 인증 설정 시 조회·내보내기도 보호. 키 없는 검토는 loopback 합성 데모로 표시 |
| 로컬 기본 화면 | CSS를 빌드에 포함. Google SDK는 사용자가 실제 연결을 선택할 때만 로드 |

기존 제공자 어댑터, 분석 보고서, 이미지 입력, 재현 평가, 과거 보고서 기능은 유지합니다. 새 검토 기록은 모델 출력·분석 캐시·기존 세션 요약과 분리합니다. 명령 실행, 자동 차단, 재시작, 패치 API는 추가하지 않습니다.

## 로컬 실행

Node.js 22.12 이상이 필요합니다. 검증에 사용한 버전과 결과는 [검증 기록](docs/VERIFICATION.ko.md)에 있습니다.

```bash
npm ci
LLM_PROVIDER=demo npm run dev
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다. API는 `127.0.0.1:8787`에서 실행됩니다. 합성 샘플을 불러와 분석한 뒤 **대응 검토 시작**을 선택하세요.

- 첫 실습은 API 키 없이 규칙 기반 demo 제공자를 사용합니다. 외부 LLM의 품질을 검증하는 과정이 아닙니다.
- `.env.example`도 `LLM_PROVIDER=demo`를 기본값으로 제공합니다. 승인된 처리 경로를 정한 뒤 다른 제공자를 명시적으로 설정하세요.
- 정적 전용 페이지에서는 검토 저장 기능을 비활성화합니다. 별도 Pages Functions + D1 어댑터는 공유 토큰으로 인증한 합성 검토를 저장합니다. 로컬 검증은 원격 배포나 Free 플랜 준비 완료를 뜻하지 않습니다.
- 기본 검토 저장 경로는 `.runtime/response-cases`입니다. 실제 기관 자료를 넣거나 서버를 외부에 공개하지 마세요.

[클라우드 검토 경계](docs/CLOUD_RESPONSE_WORKSPACE.md) · [로컬 HTTPS/D1 검증과 소유자 배포 절차](docs/CLOUD_RESPONSE_RUNBOOK.md) · [로컬 클라우드 검증 결과](docs/CLOUD_RESPONSE_VERIFICATION.md)

[화면·API·인증·저장 사용법](docs/RESPONSE_WORKFLOW.ko.md) · [합성 API 입력](samples/response-workflow.synthetic.json) · [합성 보안 JSONL](samples/security-events.synthetic.jsonl)

![실제 Chrome에서 확인한 합성 사건 대응 검토](docs/images/response-review.png)

## 검증

```bash
npm run verify
npm audit
```

`verify`는 TypeScript, Vitest, 사건 재현 평가, 실제 HTTP 아키텍처 점검, 프로덕션 빌드를 실행합니다. 검토 기능은 위조 필드, 근거 부족, 동시 수정, 잘못된 상태 전이, 저장 실패와 재개, 인증 없는 조회·내보내기를 별도로 검사합니다.

합성 사례의 통과율은 실제 진단 정확도나 MTTR 개선율이 아닙니다. 외부 LLM·운영망·실제 Google 로그인·Windows Hancom은 이 로컬 검증에 포함하지 않습니다.

## 구현 살펴보기

| 경계 | 코드 |
| --- | --- |
| 제출값과 검토 상태 | [공유 스키마](shared/responseCase.ts) |
| 합성 출처와 점검 계획 | [카탈로그](knowledge/sampleManuals.ts), [도메인·내보내기](server/lib/responseWorkflow.ts) |
| 저장·동시성·HTTP | [파일 저장소](server/lib/responseWorkflowStore.ts), [라우터](server/routes/responseWorkflows.ts) |
| 화면과 요청 수명 | [검토 카드](components/ResponseWorkflowCard.tsx), [상태 훅](hooks/useResponseWorkflow.ts) |
| 파일 입력 경계 | [JSONL 파서](services/securityEventImport.ts), [경계 테스트](__tests__/SecurityEventImport.test.ts) |
| 분석 제공자 경계 | [기존 보고서 스키마](server/lib/schemas.ts), `server/lib/`의 제공자 어댑터 |

## 도입 전에 남은 일

- **기관 자료:** 승인된 매뉴얼 등록·검색·갱신, 실제 로그 수집과 마스킹은 별도 연동 과제입니다. 현재 출처는 규칙으로 연결하는 합성 예시입니다.
- **권한:** 공유 토큰은 개인 신원이 아닙니다. OIDC 운영 구성과 기관별 권한·테넌트 격리는 별도 검증이 필요합니다.
- **저장:** 네이티브 API는 단일 프로세스 파일 저장소입니다. 선택형 클라우드 어댑터는 D1 revision 검사와 100건 한도를 사용합니다. 두 방식 모두 기관별 격리, 위변조 방지 감사 원장, 검증된 백업·복구를 제공하지 않습니다.
- **인증·구매:** CSAP·ISMS 취득, 공공 조달 등록, 실제 고객·매출 실적을 주장하지 않습니다.
- **사업성:** 가격과 시간 절감 수치는 [소개 문서](docs/PROJECT_INTRODUCTION.ko.md)의 가정·목표이며 실적이 아닙니다.

## 관련 문서

- [다섯 관련 저장소의 실제 연계 범위](docs/INTEGRATION_MAP.ko.md)
- [상세 기존 기능 참고](REFERENCE.md)
- [기존 엔지니어링 기록](docs/engineering-notes.md) · [기존 구현 결정](docs/IMPLEMENTATION_NOTES.md)
- [기존 로컬 성능 측정과 방법](docs/LOCAL_BENCHMARK.md)
- [클라우드 아키텍처](docs/cloud-ai-architecture.md) · [기계 판독 설계](docs/architecture/blueprint.json) · [아키텍처 검증기](scripts/validate_architecture_blueprint.py)
