# Phase C 감사 보고 — 검수 툴 (Review Mode)

> 감사일: 2026-08-19 · 범위: `app/review/page.tsx`, `components/ImageViewer.tsx`, `app/page.tsx` (변경분)
> 기준: `training/PHASE_C_SPEC.md` · 방식: 정적 감사 + 데이터 검증 + `npm run build` / `npm run lint` 실측

## 요약

- **BLOCKER: 0** · **MAJOR: 0** · **MINOR: 9**
- 스펙 요구사항 전 항목 충족, 빌드/린트 통과, 데이터 무결성 확인됨.
- 발견된 이슈는 모두 UX/내결함성 수준의 MINOR이며 정상 사용 경로에서 크래시·데이터 손실 없음.

## 검증 실측 결과

| 항목 | 결과 |
|---|---|
| `npm run build` (Next 16.1.6) | ✅ 통과 — `/`, `/review`, `/label`, `/login`, `/admin/export` 모두 정적 생성 |
| `npm run lint` | ✅ 통과 (경고 0) |
| `public/data/review_queue.json` | ✅ 존재, 752장, priority 1→3 오름차순 정렬 확인 (381/321/50) |
| 큐 필드 | ✅ id/age/image/items(60키)/confidence(60키)/disagree_count/pred_total_score/priority 모두 정상 |
| `items.ts` 60키 vs 큐 items 키 | ✅ 일치 |
| `confidence<1.0` 개수 vs `disagree_count` | ✅ 752장 전부 일치 |
| `sum(items)` vs `pred_total_score` | ✅ 752장 전부 일치 |
| 이미지 경로 | ✅ 752장 전부 `public/images/{age}/{id}.jpg` 존재 (404 0장) |

## 스펙 준수 체크리스트

| # | 요구사항 | 상태 | 비고 |
|---|---|---|---|
| 1 | `app/review/page.tsx` 신규 라우트 | ✅ | 기존 label/login/admin 미변경 |
| 1 | 홈 링크 | ✅ | `/` → 리다이렉트 대신 허브 페이지로 교체 (스펙 의도) |
| 2 | `/data/review_queue.json` fetch | ✅ | 실패 시 에러 화면 + 재시도 버튼 |
| 2 | priority 정렬 그대로 표시 | ✅ | |
| 2 | 진행 표시 (n/752 · priority · 남은 수) | ✅ | |
| 2 | 이전/다음 + 미검수만 보기(기본 ON) | ✅ | 단, 버튼 disabled 로직이 필터 미반영 (MINOR-2) |
| 3 | 좌측 ImageViewer 재사용 | ✅ | 404 placeholder 추가됨 |
| 3 | 우측 id/age/AI총점/이견수/priority 뱃지 | ✅ | 뱃지 매핑 1=전장검수/2=항목필터/3=자동확정 정확 |
| 3 | 60항목 체크리스트 + AI ✓/✗ | ✅ | |
| 3 | 이견항목(conf<1.0) 노란 배경 + conf 라벨 | ✅ | 터치 시 파랑으로 우선 (MINOR-7) |
| 3 | 클릭 토글 → 파란 표시 | ✅ | |
| 3 | 검수 완료 버튼 → 완료 + 다음 미검수 이동 | ✅ | |
| 4 | localStorage 키 `dap_review_state_v1` | ✅ | 스키마(fina_items/touched/reviewed_at/note) 일치 |
| 4 | 토글 즉시 저장 / 새로고침 유지 | ✅ | |
| 4 | 초기화(confirm) | ✅ | |
| 5 | Export JSONL → `reviewed_labels_<ts>.jsonl` | ✅ | 형식: id/age/items(fina)/ai_items(원본)/touched/reviewed_at |
| 5 | 검수 완료된 그림만 export | ✅ | 0장이면 alert |
| 6 | 이미지 404 placeholder | ✅ | |
| 7 | 빌드/린트 통과 | ✅ | 실측 확인 |

## 이슈 상세 (모두 MINOR)

### MINOR-1 — 404 placeholder가 절대 위치 없이 정상 흐름에 렌더
- 위치: `components/ImageViewer.tsx:112-116`
- `<Image fill>`은 absolute로 배치되는데, placeholder div는 정상 흐름(normal flow)의 형제. 겉보기엔 덮어서 동작하지만, 컨테이너 높이 계산·`<Image>`의 broken-image 글리프가 배경 아래에 남는 구조에 의존한다.
- 수정: placeholder에 `absolute inset-0 z-10` 부여하거나, `imageError` 시 `<Image>`를 렌더하지 않도록 분기.

### MINOR-2 — 이전/다음 버튼 disabled가 필터 미반영
- 위치: `app/review/page.tsx:375,383`
- `disabled={index === 0}` / `index === queue.length - 1`은 원시 큐 인덱스 기준. 미검수 필터가 ON이면 "마지막 미검수"에서도 다음 버튼이 활성화되지만 눌러도 아무 일 없음(no-op). 마찬가지로 index>0이면 이전 버튼이 활성이나 미검수가 앞에 없으면 no-op.
- 수정: 필터 ON 시 해당 방향에 미검수가 존재하는지로 disabled 계산.

### MINOR-3 — 필터 재활성화 시 이전 방향 미검수 미검색
- 위치: `app/review/page.tsx:255-258` (`toggleUnreviewedFilter`)
- 현재 항목이 검수 완료이고 이후에 미검수가 없지만 *이전에* 미검수가 존재하면 `findIndex(i>index)` → -1 → `setIndex(0)`으로 이동하나, 0번이 검수 완료면 "필터 ON + 완료 그림 표시" 상태가 됨. 전부 검수 완료인 경우도 동일.
- 수정: 0..index 구간 역방향 검색을 거쳐 최초 미검수로 이동하거나 "전부 검수 완료" 빈 상태를 표시.

### MINOR-4 — `!current` + `queue.length > 0` 분기는 사실상 데드코드
- 위치: `app/review/page.tsx:320-335`
- 큐 로드 후 index는 항상 유효하므로 도달 불가. 무해하나 혼란 방지 차원에서 정리 가능.

### MINOR-5 — `touched` 배열을 이전 state 참조에 in-place 돌연변이
- 위치: `app/review/page.tsx:161-163`
- `nextTouched = prevEntry?.touched ?? []` 후 `push`로 기존 state의 배열을 직접 수정. `includes` 가드 덕에 StrictMode 이중 호출 시 중복 추가는 없고 새 entry/state 객체 생성으로 동작은 정상이나, 이전 state 변형은 불순한 updater 패턴.
- 수정: `const nextTouched = [...(prevEntry?.touched ?? []), key]` (중복은 `includes` 체크로 유지).

### MINOR-6 — 큐 fetch 응답에 배열 검증 없음
- 위치: `app/review/page.tsx:85-87`
- 유효한 JSON이지만 배열이 아닌 객체가 오면 `queue.filter`/`queue.every`(lines 123-136)에서 TypeError. 현재 데이터로는 재현 불가(검증 완료).
- 수정: `Array.isArray(data)` 검사 후 아니라면 `setLoadError`.

### MINOR-7 — 이견 하이라이트 vs 수정 상태 우선순위
- 위치: `app/review/page.tsx:466-473`
- 스펙 3은 "이견 항목은 노란 배경". 코드는 `isTouched` 우선이라 수정한 이견 항목이 파란 배경이 됨(conf 라벨은 유지). 의도된 디자인일 가능성이 크나 스펙 문구와는 어긋남. 승인 여부 확인 필요.

### MINOR-8 — ImageViewer 줌/팬 상태가 이미지 전환 시 유지
- 위치: `components/ImageViewer.tsx:18-19`
- `src` 변경 시 scale/translate가 리셋되지 않음(기존 label 페이지와 동일 동작이라 회귀는 아님). 스펙에 명시 없음. 필요 시 `prevSrc` 갱신 시 `reset()` 호출.

### MINOR-9 — export 다운로드가 DOM 미부착 요소의 `.click()`
- 위치: `app/review/page.tsx:293-299`
- 모든 현대 브라우저에서 동작. 호환성 최대화 원하면 `document.body.appendChild(a)` → `click()` → `removeChild(a)` 패턴 권장.

## 추가 관찰 (이슈 아님)

- 손상된 localStorage JSON은 파싱 실패 시 빈 상태로 시작하며 이후 persist가 해당 키를 `{}`로 덮어씀 → "새로 시작" 의도에 부합.
- 토글만 하고 미완료인 항목은 `reviewed_at: ""`으로 저장되고 `isReviewed`가 falsy 처리 → export에서 제외. 스펙(완료분만 export)과 일치.
- `/` 라우트가 기존 `/label` 자동 리다이렉트에서 허브 페이지로 변경됨. 스펙("홈에 링크 추가")의 요구이며 회귀로 간주하지 않음.
- 홈의 `/review` 링크 텍스트가 `/review 검수 시작`으로 스펙 예시와 일치.

## 결론

Phase C 구현은 스펙을 충족하며 데이터/빌드/린트 검증 통과. BLOCKER/MAJOR 없음. MINOR 9건은 UX·견고성 개선 사항으로, 그중 MINOR-2(MINOR-3 포함)는 검수 작업 흐름에 직접 닿으므로 다음 순서로 수정을 권장함.
