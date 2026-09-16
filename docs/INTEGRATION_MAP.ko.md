# 관련 저장소와의 연계 범위

2026-09-16에 공개 소스의 README와 실제 입력·출력 코드를 확인했습니다. 모든 저장소가 실행 중인 서비스이거나 공통 API를 제공하는 것은 아닙니다. 현재의 연계 방향은 인증정보와 외부 전송이 필요하지 않은 로컬 파일 교환입니다.

| 저장소 | 확인한 구현 | AegisOps와의 연결 | 아직 검증하지 않은 사항 |
| --- | --- | --- | --- |
| [security-threat-response-workbench](https://github.com/KIM3310/security-threat-response-workbench) | 합성 JSONL 로그와 스냅샷 생성기 | 원시 JSONL을 검증해 분석 입력으로 변환 | 실시간 SIEM 연결, 실제 탐지 정확도 |
| [nw-service-assurance-workbench](https://github.com/KIM3310/nw-service-assurance-workbench) | TypeScript 정적 시나리오와 알람 형식 | 향후 버전이 있는 파일 형식으로 교환 가능 | 운영망 수집 API, 보존되는 사건 이력 |
| [secure-xl2hwp-local](https://github.com/KIM3310/secure-xl2hwp-local) | Excel 처리, 치환값 JSON, 선택적인 Windows COM 연결 | template_placeholders 형식의 인수인계 JSON | Windows·Hancom 실제 문서 생성과 서식 보존 |
| [enterprise-llm-adoption-kit](https://github.com/KIM3310/enterprise-llm-adoption-kit) | 로그 분석·검색·역할 검사·감사 API | 향후 인증과 제공자 모드를 검증한 뒤 어댑터 검토 | 데모 로그인 경로의 운영 적합성, 실제 모델 응답 |
| [llm-onprem-deployment-kit](https://github.com/KIM3310/llm-onprem-deployment-kit) | vLLM·Qdrant·TLS 게이트웨이 배포 코드 | 향후 기관 인프라에 맞춘 배포 참고 | GPU 추론, 망분리 설치, 사용자별 권한·할당량 |

위 표는 모든 연동이 완료됐다는 의미가 아닙니다. 실행 가능한 AegisOps 기능과 테스트 결과는 README와 검증 기록에서 별도로 확인합니다.

## 보안 이벤트 파일

확인한 원시 레코드에는 timestamp, detector, service, signature, severity, action, country, dst, rule_id, tuned가 있습니다. detector는 waf, ids, ddos이고 severity는 critical, major, minor, info입니다. 선택적인 인수인계 문자열도 있습니다.

AegisOps 입력 경계는 형식·길이·건수를 검증해야 합니다. 잘못된 행은 행 번호와 함께 거부합니다. action은 이전 도구가 기록한 관측값이며 실행할 명령이 아닙니다. 파일에 들어온 내용을 신뢰할 수 있는 시스템 지시로 취급하지 않습니다.

업로드한 파일이 합성 데이터라고 자동 판정하지 않습니다. 원본의 진위, 개인정보 제거, 반출 승인은 파일 파서가 증명할 수 없습니다. 네트워크 워크벤치의 알람에는 완전한 사건 시각이 없으므로 타임스탬프를 임의로 만들어서는 안 됩니다.

## 한글 문서 연계

확인한 COM 연결 함수는 JSON의 template_placeholders를 읽어 실제 한글 문서 안의 같은 문자열을 치환합니다. 따라서 키는 {{INCIDENT_ID}}처럼 중괄호를 포함한 실제 치환 문자열이어야 합니다.

```json
{
  "template_name": "incident-handover-v1",
  "templateValidated": false,
  "template_placeholders": {
    "{{INCIDENT_ID}}": "synthetic-example",
    "{{SUMMARY}}": "합성 사건의 인수인계 요약",
    "{{REVIEW_STATUS}}": "초안. 실행 승인 아님"
  }
}
```

이 JSON은 HWP 또는 HWPX 파일이 아닙니다. 실제 생성에는 Windows, pywin32, 설치된 Hancom 프로그램과 동일한 치환 문자열을 가진 템플릿이 필요합니다. 해당 환경에서 긴 문장, 표, 한글, 결재란, 누락된 치환값, COM 실패를 검증해야 합니다. 이 한컴 치환 JSON 내보내기 경로는 외부 프로젝트를 자동 실행하거나 파일을 외부 서비스로 보내지 않습니다. 별도로 설정한 분석 제공자나 Google 내보내기를 실제로 사용하면 데이터가 외부로 전송될 수 있으므로, 처리 경로와 자료 사용 승인을 먼저 확인해야 합니다.

## 운영 배포 전에 남은 경계

- 데모 로그인에서 사용자가 보낸 역할이나 claims를 운영 신원처럼 사용하지 않습니다. 검증된 토큰 교환 경로와 발급자·대상·만료·역할 조건을 별도로 확인해야 합니다.
- 공유 API 키가 있다는 사실은 사용자별 권한, 테넌트 격리, 요청 할당량을 의미하지 않습니다.
- Helm이나 Terraform 코드가 있다는 사실은 GPU 추론과 오프라인 설치를 검증했다는 의미가 아닙니다.
- 합성 사례의 근거 일치율을 실제 장애 원인 진단 정확도나 기관의 감사 적합성으로 표현하지 않습니다.

## 고정된 소스 근거

- [보안 로그 생성기](https://raw.githubusercontent.com/KIM3310/security-threat-response-workbench/85c24e3f4ae9141f49994dc9a581fd0448f6b861/scripts/build_security_snapshot.py)
- [네트워크 시나리오 타입](https://raw.githubusercontent.com/KIM3310/nw-service-assurance-workbench/0bd4b0f8c6ea08ebce9576b0fd22edcecefe5ffd/src/types.ts)
- [Windows Hancom 연결 함수](https://raw.githubusercontent.com/KIM3310/secure-xl2hwp-local/35e212ff28446995ab89c566a718e25674434150/app/connectors/hancom_windows.py)
- [기업 도입 키트 API](https://raw.githubusercontent.com/KIM3310/enterprise-llm-adoption-kit/465db163a4dc4cc7aa53bee3e82a8d19a9ad3064/app/backend/app/main.py)
- [온프레미스 배포 기본값](https://raw.githubusercontent.com/KIM3310/llm-onprem-deployment-kit/a7441085b588f1598ae50fa4a420d0c914c02432/helm/llm-stack/values.yaml)
