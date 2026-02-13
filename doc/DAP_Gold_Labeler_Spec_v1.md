# DAP Gold Labeler (Male 01–60) — Spec v1

> 목적: 여러 명이 동시에 웹에서 인물화(골드 200장)를 **남자척도 01~60** 기준으로 **pass/fail(1/0)** 채점하고, 결과를 **실시간 동기화**하며, 언제든 **JSON/JSONL로 Export**할 수 있는 라벨링 웹앱을 만든다.

---

## 0) 핵심 결정사항(고정)

- **채점값은 0/1만** 사용 (부분점수 없음)
- 파일명: `0001.png` ~ `0952.png` (이미지명에는 나이 정보 없음)
- 이미지 저장 구조(로컬/배포 공통):
  - `public/images/{age}/{id}.png`
  - 예: `public/images/4/0001.png`
- 나이(`age`)는 **manifest 메타데이터**로만 관리 (모델 입력 텍스트에는 포함하지 않음)
- “실시간 JSON 파일” 요구는 현실적으로 **실시간 DB(Firestore)**로 충족하고, **Export** 시 JSON/JSONL로 파일을 생성한다.

---

## 1) 사용자 플로우

1. 로그인(Google OAuth)
2. 메인 라벨링 화면에서 현재 이미지(1~200) 확인
3. 우측 60개 항목 체크(체크=1, 미체크=0)
4. 체크 즉시 저장 → 다른 사용자 화면에도 즉시 반영
5. “다음/뒤로”로 이미지 이동
6. (관리자) Export 페이지에서 `gold_labels.json` / `gold_labels.jsonl` 다운로드

---

## 2) UI 요구사항(첨부 시안 기준)

### 2.1 레이아웃
- 상단 중앙: **이미지 번호(1~200)** 표시 + `id`, `age` 표시
- 좌측 큰 패널: 이미지 뷰어
- 우측 패널: 채점항목 리스트 60개(스크롤 가능)
- 우측 상단: 저장 상태(저장중/저장됨/실패), 마지막 수정자/시간
- 우측 패널 상단: **통과 개수 x/60**
- (권장) `reviewed` 토글: “채점 완료”
- 하단: `뒤로` / `다음` 버튼

### 2.2 이미지 뷰어 기능
- Zoom in/out
- 드래그(pan)
- Reset(원래 크기/위치)

---

## 3) 동시 편집 규칙(Realtime Collaboration)

- 현재 선택된 이미지 `labels/{id}` 문서를 **onSnapshot**으로 구독한다.
- 체크박스 변경 시 **즉시 update**한다.
- 충돌 해결: **Last Write Wins** (Firestore 기본)
- 쓰기 과다 방지: **debounce 200ms** (체크 연타 대비)

> v1에서는 “잠금(lock)/할당(assign)” 기능은 제외(추가 개발로 확장 가능).

---

## 4) 데이터 모델(Firestore)

### 4.1 `manifests/default`
- 라벨링 대상 이미지 목록(골드 200장 대상) + 메타데이터를 저장
```json
{
  "schema_version": "dap_male_v1",
  "images": [
    { "id": "0001", "age": 4, "path": "/images/4/0001.png" },
    { "id": "0002", "age": 4, "path": "/images/4/0002.png" }
  ],
  "updatedAt": "serverTimestamp"
}
```

> **중요:** `path` 문자열은 UI에서 이미지 로드에만 사용하며, 모델 학습 텍스트 입력으로 섞이지 않도록 한다(데이터 누수 방지).

### 4.2 `labels/{id}`
- 이미지 1장당 1문서
```json
{
  "id": "0001",
  "age": 4,
  "view": "front|profile|mixed|unknown",
  "items": { "m01_head": 0, "...": 0, "m60_limb_motion": 0 },
  "reviewed": false,
  "updatedAt": "serverTimestamp",
  "updatedBy": { "uid": "...", "email": "...", "displayName": "..." }
}
```

### 4.3 `users/{uid}` (권장)
- role 관리(annotator/admin)
```json
{ "role": "annotator|admin", "email": "..." }
```

---

## 5) 채점항목(남자척도 01~60)

### 5.1 키 네이밍 규칙(고정)
- `m` + 두자리번호 + snake_case
- 예: `m01_head` … `m60_limb_motion`

### 5.2 UI 표기용 항목 목록(60개)
- 01 머리
- 02 목
- 03 목: 평면
- 04 눈
- 05 눈의 세부: 눈썹
- 06 눈의 세부: 눈동자
- 07 눈의 세부: 비율
- 08 눈의 세부: 응시
- 09 코
- 10 코: 평면
- 11 입
- 12 입술: 평면
- 13 턱과 이마
- 14 턱의 돌출
- 15 턱의 선
- 16 콧날
- 17 머리카락 I
- 18 머리카락 II
- 19 머리카락 III
- 20 귀
- 21 귀: 비율과 위치
- 22 손가락
- 23 정확한 수의 손가락
- 24 손가락의 정확한 세부
- 25 엄지손가락의 분화
- 26 손
- 27 손목 또는 발목
- 28 팔
- 29 어깨 I
- 30 어깨 II
- 31 옆으로 내리거나 운동하고 있는 팔
- 32 다리
- 33 엉덩이 I(가랑이)
- 34 엉덩이 II
- 35 무릎관절
- 36 발 I
- 37 발 II: 비율
- 38 발 III: 뒷꿈치
- 39 발 IV: 원근법
- 40 팔, 다리 달린 것
- 41 팔, 다리 달린 것 II
- 42 동체
- 43 동체의 비율: 평면적
- 44 비율: 머리와 동체
- 45 비율: 얼굴
- 46 비율: 팔과 동체
- 47 비율: 팔
- 48 비율: 다리와 동체
- 49 비율: 팔·다리 > 손·발
- 50 옷 I
- 51 옷 II
- 52 옷 III
- 53 옷 IV
- 54 측면화(옆을 보고 있는 모습)
- 55 운동 조정: 선과 연결
- 56 세련된 선과 형태: 머리윤곽
- 57 세련된 선과 형태: 동체
- 58 세련된 선과 형태: 얼굴의 모양
- 59 Sketch 및 실제감 표현의 기술
- 60 팔과 다리의 운동

---

## 6) Export 요구사항

### 6.1 접근
- `/admin/export` 페이지 (admin만 접근)

### 6.2 출력 포맷
- `gold_labels.json`: 배열 형태
- `gold_labels.jsonl`: 한 줄당 JSON 1개

### 6.3 누락 처리
- `labels/{id}` 문서가 없으면:
  - `missing: true`를 포함하고 `items`는 0으로 채운다(기본값)
  - Export 화면에 “누락 개수” 표시

예시(JSONL 1줄):
```json
{"id":"0001","age":4,"view":"unknown","items":{"m01_head":0,"m02_neck":0,"m03_neck_plane":0,"m04_eyes":0,"...":0,"m60_limb_motion":0},"reviewed":false,"missing":true}
```

---

## 7) 기술스택(권장)

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Firebase
  - Auth (Google)
  - Firestore (Realtime)
  - Storage는 v1에선 필수 아님(이미지를 `public/`로 서빙)

---

## 8) 구현 요구사항(파일 구조)

- `/app/login/page.tsx`
- `/app/label/page.tsx` (메인)
- `/app/admin/export/page.tsx`
- `/lib/firebase.ts` (Firebase init)
- `/lib/firestore.ts` (labels/manifest CRUD)
- `/data/items.ts` (60개 항목 배열: `{ key, label, group? }`)
- UI components
  - `ImageViewer.tsx`
  - `ItemChecklist.tsx`
  - `TopBar.tsx`
  - `NavButtons.tsx`

---

## 9) 초기 데이터(Manifest) 주입(Seed)

### 옵션 A(권장): Seed 스크립트 1회 실행
- `scripts/seedManifest.ts`를 제공
- 로컬의 `data/manifest.json`을 읽어 `manifests/default`에 업로드

### 옵션 B: Admin UI 업로드
- `/admin/manifest` 페이지에서 JSON 업로드

v1에서는 **옵션 A**가 구현이 단순함.

---

## 10) 환경 변수(.env.local)

Firebase Web App 설정값 필요:
- `NEXT_PUBLIC_FIREBASE_API_KEY=...`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID=...`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...` (필요 시)
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...`
- `NEXT_PUBLIC_FIREBASE_APP_ID=...`

Admin 설정(간단 버전):
- `ADMIN_EMAILS=admin1@gmail.com,admin2@gmail.com`

---

## 11) README에 포함할 실행 방법

- `npm install`
- `.env.local` 설정
- `npm run dev`
- (최초 1회) `npm run seed:manifest`
- 브라우저에서 `/login` → `/label`

---

## 12) 향후 확장(옵션)
- 이미지 잠금(lock) / 작업 할당(assign)
- 변경 이력(history) 저장
- 품질 플래그(unscorable) 추가
- 단축키(1=pass, 0=fail, n=next, p=prev)
