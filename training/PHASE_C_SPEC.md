# Phase C 스펙 — 검수 툴 (Review Mode)

> 작성: 2026-08-19 · 대상: `app/review/` 신규 페이지 (기존 label 페이지 수정 금지)
> 목표: 주인님이 혼자 브라우저에서 752장 pseudo-label을 우선순위대로 검수하고,
> 수정·확정 이력을 localStorage에 저장하고 JSONL로 export할 수 있게 한다.
> Firebase 없이 동작 (static 로드 + localStorage + 다운로드).

## 배경 데이터

- `public/data/review_queue.json` (아리아가 준비): 752장, 검수 우선순위 정렬됨.
  각 레코드:
  ```json
  {
    "id": "0836", "age": 10, "image": "/images/10/0836.jpg",
    "items": {"m01_head": 1, "...": 0},
    "confidence": {"m01_head": 1.0, "...": 0.67},
    "disagree_count": 5,
    "pred_total_score": 14,
    "priority": 1
  }
  ```
- priority: 1 = 전장검수(이견5+ 또는 총점25+), 2 = 항목필터(이견2~4), 3 = 자동확정(이견0~1, 참고용).
- `public/images/`에 952장 전체 이미지가 이미 있다 (기존 구조). 이번에 752장용 이미지는
  images/에 이미 존재하므로 별도 복사 불필요 (public/images 와 images 가 별개면 public/images 로 복사 필요 — 확인할 것).

## 요구사항

### 1. 라우트
- `app/review/page.tsx` — 기존 app/label 은 절대 수정하지 않는다.
- 홈(app/page.tsx)에 "/review 검수 시작" 링크 하나 추가 (최소 변경).

### 2. 검수 큐
- fetch("/data/review_queue.json") 로 로드.
- priority 순으로 정렬된 그대로 표시 (이미 정렬돼 있음).
- 상단 진행 표시: 현재 위치 (예: "87 / 752 · priority 1 (전장검수)") + 남은 수.
- "이전 / 다음" 버튼 + "미검수만 보기" 필터(기본 ON — 검수 완료한 그림은 큐에서 숨김).
  검수 완료된 그림도 목록에서 다시 열 수 있게 작은 진행 리스트(좌측 축소 목록) 제공은 선택.

### 3. 화면 구성 (label 페이지와 유사 레이아웃)
- 좌측: 이미지 뷰어 (ImageViewer 재사용 가능하면 재사용, image 경로는 `/images/{age}/{id}.jpg`... 단 review_queue.json의 image 필드 그대로 사용)
- 우측 상단: id / age / AI 총점 / 이견 항목 수 / priority 뱃지
- 우측: 60항목 체크리스트 — 각 항목에:
  - 항목명 + AI 예측값 (✓/✗ 체크박스로 표시)
  - **이견 항목(confidence < 1.0)은 노란 배경 하이라이트 + "conf 0.67" 라벨 표시**
  - 사용자가 클릭하면 체크 토글 (수정 상태 → 파란 표시)
- "검수 완료" 버튼 → 완료 표시 후 다음 미검수 그림으로 이동.

### 4. 상태 저장 (localStorage, 키: `dap_review_state_v1`)
```json
{
  "0836": {
    "final_items": {"m01_head": 1, "...": 0},
    "touched": ["m44_ratio_head_torso"],
    "reviewed_at": "2026-08-19T10:00:00Z",
    "note": ""
  },
  "...": "..."
}
```
- 체크 토글 시 즉시 저장 (debounce 불필요, 단순 저장).
- 새로고침해도 상태 유지.
- "초기화" 버튼: 확인(confirm) 후 전체 상태 삭제.

### 5. Export
- "Export JSONL" 버튼 → `reviewed_labels_<timestamp>.jsonl` 다운로드.
- 형식 (라인당):
  ```json
  {"id":"0836","age":10,"items":{"m01_head":1,...},"ai_items":{...},"touched":[...],"reviewed_at":"..."}
  ```
  - items = final (수정 반영), ai_items = 원본 AI 예측, touched = 사용자가 바꾼 항목.
- 검수 완료된 그림만 export.

### 6. 안전
- localStorage 용량 초과 걱정 없음 (752 × ~2KB = 1.5MB, 충분).
- fetch 실패 시 에러 표시.
- 이미지 경로가 404면 placeholder 표시.

### 7. 검증 요구
- `npm run build` 성공 필수 (Next.js 16 빌드 통과).
- `npm run lint` 통과 (신규 코드 관련 에러 없을 것).
- 기존 label/login/admin 페이지 동작에 영향 없음 (신규 라우트만 추가).

## 참고: 기존 코드 스타일
- app/label/page.tsx, components/ItemChecklist.tsx 를 참고해 Tailwind 스타일과 구조를 맞춘다.
- 데이터 항목 정의는 data/items.ts 의 60개 키 그대로.
