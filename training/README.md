# Qwen3-VL 4B Run-1 Training

이 폴더는 Gold Labeler의 1차 보조 모델(752장 자동채점 보조) 학습용 스크립트입니다.

## 전제 데이터 경로

- `training_bundle/data/train_vlm.jsonl`
- `training_bundle/data/val_vlm.jsonl`
- `training_bundle/data/test_vlm.jsonl`
- `training_bundle/images/...`

## RunPod 실행

```bash
pip install -r training/requirements.txt
python training/train_qwen3vl_4b.py
python training/eval_qwen3vl_4b.py
```

## 출력 경로

- `training/output/qwen3vl_4b_run1/`

## 스크립트 특징

- Qwen3-VL 4B Instruct 계열 모델 로드(후보 순차 시도)
- Unsloth LoRA/QLoRA 기반 SFT
- train/val/test 샘플 수 로그 출력
- GPU/device 정보 출력
- 학습 후 validation 평가 로그 출력
- 에러 시 확인할 경로/원인 안내 메시지 출력
