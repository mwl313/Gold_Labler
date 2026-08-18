# Phase B 스펙 — 752장 자동채점 (Pseudo-labeling) 스크립트

> 작성: 2026-08-18 · 대상: `training/pseudo_label_752.py` 신규 제작
> 목표: 1차 모델(Qwen3-VL 8B LoRA)로 골드 200장을 제외한 나머지 752장을 채점하고,
> 60항목 0/1 + 항목별 confidence를 산출한다. (Phase C 검수용 입력 데이터)

---

## B-2 결정사항: confidence 산출 방식 = 샘플링 앙상블 (3회, 항목별 동의율)

선정 이유:
- logprobs 방식은 Unsloth FastVisionModel에서 로짓 추출·항목-토큰 매핑이 취약
- 동의율은 구현이 단순하고 해석이 직관적 — 라벨링 툴 필터("동의율 < 1.0 항목만 보기")와 직결

규칙:
- 샘플당 **3회 생성**: `do_sample=True, temperature=0.3, top_p=0.9`, seed는 `3407 + 시도번호` (재현성)
- `max_new_tokens=1024` (1차 eval과 동일)
- 각 시도에서 60항목 JSON 파싱 → 파싱 성공한 시도만 사용
- **final 값 = 다수결** (3회 성공 시 2:1 이상, 2회 성공 시 2:0 또는 1:1→0)
- **confidence_k = 동의율** (1.0 / 0.67 / 0.5 / 0.33 중 하나)
- 3회 중 파싱 성공 ≤ 1회 → 그 샘플은 `needs_review=true`, items는 성공분 다수결(1회면 그 값), confidence 전부 0.33
- 어느 항목이든 confidence < 1.0 → 샘플 단위 `has_low_confidence=true` (검수 큐 필터용)

## B-1 결정사항: 배치 추론 스크립트 요구사항

### 입력
- 체크포인트: `training/output/qwen3vl_8b_run1/` (adapter_config.json의 base_model_name_or_path로 base 로드 + PeftModel — `eval_qwen3vl_8b.py`의 `load_checkpoint_model()` 패턴 그대로 재사용)
- 제외 목록: `data/manifest.json`의 images 배열 (골드 200장 id)
- 대상: `images/{age}/{id}.jpg` 전체 중 골드 200 제외 = 752장 (age는 경로에서 추출)
- 프롬프트: train/eval과 동일한 채점 프롬프트 텍스트

### 출력 (`data/pseudo_labels_752.jsonl`, 한 줄당 JSON 1개)
```json
{
  "id": "0045", "age": 5, "image": "images/5/0045.jpg",
  "items": {"m01_head": 1, "...": 0, "m60_limb_motion": 0},
  "confidence": {"m01_head": 1.0, "...": 0.67},
  "parse_ok_count": 3,
  "agree_3of3_count": 55,
  "needs_review": false,
  "has_low_confidence": true,
  "pred_total_score": 14
}
```

### 필수 기능 (크레딧 낭비 방지 — 꼼꼼 구현)
1. **Resume**: 실행 시작 시 기존 출력 jsonl의 id 집합을 읽고, 이미 처리된 id는 스킵. 중간에 죽어도 재실행하면 이어서 진행.
2. **--dry-run 모드**: 모델 로드 없이 (로컬 Mac에서도 실행 가능) 대상 752장 목록 생성, 경로 존재 검증, 출력 포맷 더미 생성(가짜 items/confidence), resume 로직까지 전부 테스트. `--limit 5`로 5장만.
3. **--limit N**: 앞 N장만 처리 (RunPod 스모크 테스트용).
4. **배치 처리**: batch_size 8. 프로세서로 이미지 배치 한 번에 전처리, generate도 배치. `torch.inference_mode()`, `use_cache=True`. 진행 로그는 `print(..., flush=True)`로 실시간.
5. **주기적 플러시**: jsonl은 append 모드 + flush. 중간에 죽어도 처리 완료분은 보존.
6. **완료 후 요약 리포트**: `data/pseudo_labels_752_report.json` — 총/성공/실패 수, 파싱률, needs_review 수, has_low_confidence 수, 항목별 평균 confidence, 소요 시간.
7. 파싱은 `eval_qwen3vl_8b.py`의 `try_parse_predicted_items` 로직 재사용 (fence/중괄호 폴백).

### 금지/주의
- Test 40장(gold split=test)은 대상에 아예 포함 안 됨 — 제외 목록이 골드 200 전부이므로 자연히 포함되지 않지만, 코드에 assert로 확인.
- temperature 샘플링 시 JSON이 잘리지 않도록 max_new_tokens=1024 유지.
- 골드 200장의 id와 겹치는 대상이 있으면 오류(assert) — 목록 생성 시 검증.
