import copy
import json
import sys
import math
from pathlib import Path
from typing import Any

# Keep unsloth imports before TRL/Transformers/PEFT to avoid compatibility warnings.
from unsloth import FastVisionModel
from unsloth.trainer import UnslothVisionDataCollator

import torch
from PIL import Image
from datasets import Dataset
from trl import SFTConfig, SFTTrainer

# Paths
REPO_ROOT = Path(__file__).resolve().parents[1]
TRAIN_JSONL = REPO_ROOT / "training_bundle" / "data" / "train_vlm.jsonl"
VAL_JSONL = REPO_ROOT / "training_bundle" / "data" / "val_vlm.jsonl"
TEST_JSONL = REPO_ROOT / "training_bundle" / "data" / "test_vlm.jsonl"
OUTPUT_DIR = REPO_ROOT / "training" / "output" / "qwen3vl_4b_run1"

# Qwen3-VL 4B candidate names (try in order)
MODEL_CANDIDATES = [
    "unsloth/Qwen3-VL-4B-Instruct-unsloth-bnb-4bit",
    "unsloth/Qwen3-VL-4B-Instruct-bnb-4bit",
    "Qwen/Qwen3-VL-4B-Instruct",
]

# Conservative run-1 hyperparameters
NUM_EPOCHS = 4
PER_DEVICE_BATCH = 1
GRAD_ACC_STEPS = 8
LEARNING_RATE = 1e-4
MAX_LENGTH = 2048
RANK = 16
LORA_ALPHA = 16
SEED = 3407


def log_env() -> None:
    print("=== Device / Runtime Info ===")
    print(f"Python: {sys.version.split()[0]}")
    print(f"Torch: {torch.__version__}")
    print(f"CUDA available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"GPU count: {torch.cuda.device_count()}")
        for idx in range(torch.cuda.device_count()):
            print(f"GPU[{idx}]: {torch.cuda.get_device_name(idx)}")
        print(f"BF16 supported: {torch.cuda.is_bf16_supported()}")
    else:
        print("GPU가 감지되지 않았습니다. RunPod GPU 인스턴스에서 실행하세요.")


def must_exist(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(
            f"필수 파일이 없습니다: {path}\n"
            "training_bundle/data 경로와 파일명을 확인하세요."
        )


def resolve_image_path(raw: str) -> Path:
    value = raw.replace("\\", "/").strip()
    candidates: list[Path] = []

    p = Path(value)
    if p.is_absolute():
        candidates.append(p)

    candidates.append(REPO_ROOT / value)
    candidates.append(REPO_ROOT / value.lstrip("/"))

    if value.startswith("public/images/"):
        suffix = value[len("public/images/") :]
        candidates.append(REPO_ROOT / "training_bundle" / "images" / suffix)
    elif value.startswith("images/"):
        suffix = value[len("images/") :]
        candidates.append(REPO_ROOT / "training_bundle" / "images" / suffix)
    elif value.startswith("/images/"):
        suffix = value[len("/images/") :]
        candidates.append(REPO_ROOT / "training_bundle" / "images" / suffix)

    for candidate in candidates:
        if candidate.exists():
            return candidate

    raise FileNotFoundError(
        f"이미지 파일을 찾지 못했습니다: {raw}\n"
        f"확인한 기준 루트: {REPO_ROOT}"
    )


def attach_image_to_messages(messages: list[dict[str, Any]], image: Image.Image) -> list[dict[str, Any]]:
    converted = copy.deepcopy(messages)
    user_msg = next((m for m in converted if m.get("role") == "user"), None)
    if user_msg is None:
        raise ValueError("messages에 role='user'가 없습니다.")

    content = user_msg.get("content")
    if not isinstance(content, list):
        raise ValueError("user message의 content가 list 형태가 아닙니다.")

    image_attached = False
    for item in content:
        if isinstance(item, dict) and item.get("type") == "image":
            item["image"] = image
            image_attached = True
            break

    if not image_attached:
        content.insert(0, {"type": "image", "image": image})

    return converted


def load_jsonl_dataset(path: Path, split_name: str) -> Dataset:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for lineno, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError as e:
                raise ValueError(f"{path}:{lineno} JSON 파싱 실패 - {e}") from e

            image_raw = raw.get("image")
            messages = raw.get("messages")
            if not isinstance(image_raw, str):
                raise ValueError(f"{path}:{lineno} image 필드가 문자열이 아닙니다.")
            if not isinstance(messages, list):
                raise ValueError(f"{path}:{lineno} messages 필드가 list가 아닙니다.")

            image_path = resolve_image_path(image_raw)
            image = Image.open(image_path).convert("RGB")

            rows.append(
                {
                    "id": str(raw.get("id", "")),
                    "split": split_name,
                    "messages": attach_image_to_messages(messages, image),
                }
            )

    if not rows:
        raise ValueError(f"{path}에 학습 샘플이 없습니다.")

    return Dataset.from_list(rows)


def load_model():
    last_error: Exception | None = None
    for model_name in MODEL_CANDIDATES:
        try:
            print(f"[Model] trying: {model_name}")
            model, tokenizer = FastVisionModel.from_pretrained(
                model_name=model_name,
                load_in_4bit=True,
                use_gradient_checkpointing="unsloth",
            )
            print(f"[Model] loaded: {model_name}")
            return model, tokenizer, model_name
        except Exception as e:
            last_error = e
            print(f"[Model] failed: {model_name} ({e})")

    raise RuntimeError(
        "Qwen3-VL 4B 모델 로드에 실패했습니다. MODEL_CANDIDATES 또는 Hugging Face 접근 권한을 확인하세요."
    ) from last_error


def estimate_total_steps(sample_count: int) -> int:
    effective_batch = max(PER_DEVICE_BATCH * GRAD_ACC_STEPS, 1)
    steps_per_epoch = max(math.ceil(sample_count / effective_batch), 1)
    return steps_per_epoch * NUM_EPOCHS


def main() -> None:
    log_env()

    for p in [TRAIN_JSONL, VAL_JSONL, TEST_JSONL]:
        must_exist(p)

    print("\n=== Loading Datasets ===")
    train_ds = load_jsonl_dataset(TRAIN_JSONL, "train")
    val_ds = load_jsonl_dataset(VAL_JSONL, "val")
    test_ds = load_jsonl_dataset(TEST_JSONL, "test")
    print(f"Train samples: {len(train_ds)}")
    print(f"Val samples: {len(val_ds)}")
    print(f"Test samples: {len(test_ds)}")

    model, tokenizer, loaded_model_name = load_model()
    print(f"\nUsing model: {loaded_model_name}")

    model = FastVisionModel.get_peft_model(
        model,
        finetune_vision_layers=True,
        finetune_language_layers=True,
        finetune_attention_modules=True,
        finetune_mlp_modules=True,
        r=RANK,
        lora_alpha=LORA_ALPHA,
        lora_dropout=0.0,
        bias="none",
        random_state=SEED,
        use_rslora=False,
        loftq_config=None,
    )

    FastVisionModel.for_training(model)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    use_bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()
    total_steps = estimate_total_steps(len(train_ds))
    warmup_steps = max(5, int(total_steps * 0.05))
    print(f"Estimated total steps: {total_steps}")
    print(f"Warmup steps: {warmup_steps}")

    args = SFTConfig(
        output_dir=str(OUTPUT_DIR),
        num_train_epochs=NUM_EPOCHS,
        per_device_train_batch_size=PER_DEVICE_BATCH,
        gradient_accumulation_steps=GRAD_ACC_STEPS,
        learning_rate=LEARNING_RATE,
        warmup_steps=warmup_steps,
        logging_steps=5,
        save_strategy="epoch",
        eval_strategy="epoch",
        optim="adamw_8bit",
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        seed=SEED,
        report_to="none",
        remove_unused_columns=False,
        dataset_text_field="",
        dataset_kwargs={"skip_prepare_dataset": True},
        max_length=MAX_LENGTH,
        fp16=not use_bf16,
        bf16=use_bf16,
    )

    trainer = SFTTrainer(
        model=model,
        processing_class=tokenizer,
        data_collator=UnslothVisionDataCollator(model, tokenizer),
        train_dataset=train_ds,
        eval_dataset=val_ds,
        args=args,
    )

    print("\n=== Training Start ===")
    train_result = trainer.train()
    print("\n=== Training Done ===")
    print(train_result)

    print("\n=== Validation Evaluation ===")
    eval_metrics = trainer.evaluate(eval_dataset=val_ds)
    print(eval_metrics)

    print("\n=== Saving Checkpoint ===")
    trainer.save_model(str(OUTPUT_DIR))
    tokenizer.save_pretrained(str(OUTPUT_DIR))
    print(f"Saved to: {OUTPUT_DIR}")

    print("\n=== Notes ===")
    print("- test split은 학습에 사용하지 않았습니다.")
    print("- 필요 시 training/output/qwen3vl_4b_run1 에서 이어학습 가능합니다.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("\n[ERROR] 학습 스크립트 실행 실패")
        print(f"- message: {e}")
        print("- 점검할 경로:")
        print(f"  * {TRAIN_JSONL}")
        print(f"  * {VAL_JSONL}")
        print(f"  * {TEST_JSONL}")
        print(f"  * {REPO_ROOT / 'training_bundle' / 'images'}")
        print("- 점검할 항목:")
        print("  * RunPod GPU 인스턴스 사용 여부")
        print("  * requirements 설치 여부")
        print("  * Hugging Face 모델 접근 권한 / 네트워크")
        raise
