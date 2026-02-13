# DAP Gold Labeler

Next.js + Firebase 기반의 인물화 골드 라벨링 웹앱입니다.

## 1) 설치

```bash
npm install
```

## 2) 환경 변수 (`.env.local`)

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# /admin/export 접근 허용 이메일(쉼표 구분)
ADMIN_EMAILS=admin1@gmail.com,admin2@gmail.com

# seed 스크립트용(택1)
# FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
# 또는 GOOGLE_APPLICATION_CREDENTIALS 경로 사용
FIREBASE_PROJECT_ID=...
```

## 3) 개발 서버 실행

```bash
npm run dev
```

## 4) 골드 Manifest 생성(연령별 층화추출)

```bash
npm run build:manifest
```

- 기본 seed: `20260213`
- 생성 파일: `data/manifest.json`
- 규칙:
  - age별 샘플 수량 고정(합계 200)
  - seed 기반 셔플로 재현 가능
  - age별 Train/Val/Test 수량 고정

다른 seed 사용:

```bash
ts-node scripts/buildManifest.ts --seed=12345
```

## 5) Firestore에 Manifest 업로드(최초 1회)

```bash
npm run seed:manifest
```

- 업로드 대상: `manifests/default`

## 6) 사용법

1. `/login` 접속 후 Google 로그인
2. `/label`에서 manifest 기반 이미지 라벨링
3. 체크박스 변경은 200ms debounce 후 Firestore `labels/{id}`에 저장
4. 상단에서 현재 이미지 번호 `(i/N)` 확인 (`N = manifest.images.length`)

## 7) Export

- `/admin/export` (admin만 접근)
- 다운로드:
  - `gold_labels.json`
  - `gold_labels.jsonl`
- 기준:
  - `manifests/default.images` 200개
  - `labels/{id}` 누락 시 `missing: true` + `items` 전부 `0`

## 8) 주요 경로

- `app/login/page.tsx`
- `app/label/page.tsx`
- `app/admin/export/page.tsx`
- `lib/firebase.ts`
- `lib/firestore.ts`
- `data/items.ts`
- `scripts/buildManifest.ts`
- `scripts/seedManifest.ts`
