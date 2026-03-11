import json
import math
import re
from pathlib import Path
from typing import Any

# Keep unsloth imports before transformers/trl/peft imports to avoid warnings.
from unsloth import FastVisionModel

import torch
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT_DIR = REPO_ROOT / "training" / "output" / "qwen3vl_4b_run1"
TEST_JSONL = REPO_ROOT / "training_bundle" / "data" / "test_vlm.jsonl"
REPORT_JSON = CHECKPOINT_DIR / "test_eval_report.json"
REPORT_MD = CHECKPOINT_DIR / "test_eval_report.md"


def load_expected_keys() -> list[str]:
    items_ts = REPO_ROOT / "data" / "items.ts"
    if not items_ts.exists():
        raise FileNotFoundError(f"items 정의 파일을 찾지 못했습니다: {items_ts}")

    source = items_ts.read_text(encoding="utf-8")
    keys = re.findall(r'key:\s*"([^"]+)"', source)
    if len(keys) != 60:
        raise ValueError(f"items 키 개수가 60이 아닙니다: {len(keys)}")
    return keys


def resolve_image_path(raw: str) -> Path:
    value = raw.replace("\\", "/").strip()
    candidates: list[Path] = []
    p = Path(value)
    if p.is_absolute():
        candidates.append(p)
    candidates.append(REPO_ROOT / value.lstrip("/"))
    candidates.append(REPO_ROOT / value)

    if value.startswith("public/images/"):
        suffix = value[len("public/images/") :]
        candidates.append(REPO_ROOT / "training_bundle" / "images" / suffix)
    elif value.startswith("images/"):
        suffix = value[len("images/") :]
        candidates.append(REPO_ROOT / "training_bundle" / "images" / suffix)
    elif value.startswith("/images/"):
        suffix = value[len("/images/") :]
        candidates.append(REPO_ROOT / "training_bundle" / "images" / suffix)

    for c in candidates:
        if c.exists():
            return c

    raise FileNotFoundError(f"이미지 파일을 찾지 못했습니다: {raw}")


def load_test_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for lineno, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as e:
                raise ValueError(f"{path}:{lineno} JSON 파싱 실패 - {e}") from e
            rows.append(row)
    if not rows:
        raise ValueError(f"{path}가 비어 있습니다.")
    return rows


def extract_gt_items(row: dict[str, Any], expected_keys: list[str]) -> dict[str, int]:
    try:
        text = row["messages"][1]["content"][0]["text"]
        parsed = json.loads(text)
    except Exception as e:
        raise ValueError(f"GT items 파싱 실패 (id={row.get('id')}): {e}") from e

    normalized: dict[str, int] = {}
    for key in expected_keys:
        value = parsed.get(key, 0)
        normalized[key] = 1 if value == 1 else 0
    return normalized


def build_user_messages(row: dict[str, Any]) -> list[dict[str, Any]]:
    messages = row.get("messages")
    if not isinstance(messages, list):
        raise ValueError(f"messages 형식 오류 (id={row.get('id')})")
    user_msg = next((m for m in messages if m.get("role") == "user"), None)
    if not user_msg:
        raise ValueError(f"user message 누락 (id={row.get('id')})")
    return [user_msg]


def try_parse_predicted_items(
    text: str,
    expected_keys: list[str],
) -> tuple[bool, dict[str, int], str]:
    raw = text.strip()
    candidates: list[str] = [raw]

    fence_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, flags=re.DOTALL)
    if fence_match:
        candidates.append(fence_match.group(1).strip())

    l = raw.find("{")
    r = raw.rfind("}")
    if l != -1 and r != -1 and l < r:
        candidates.append(raw[l : r + 1])

    parsed_obj = None
    parse_error = "JSON object not found"
    for candidate in candidates:
        try:
            parsed_obj = json.loads(candidate)
            break
        except Exception as e:
            parse_error = str(e)

    if not isinstance(parsed_obj, dict):
        return False, {k: 0 for k in expected_keys}, parse_error

    normalized = {}
    for key in expected_keys:
        value = parsed_obj.get(key, 0)
        normalized[key] = 1 if value == 1 else 0
    return True, normalized, ""


def compute_binary_metrics(gt: list[int], pred: list[int]) -> dict[str, float]:
    tp = tn = fp = fn = 0
    for g, p in zip(gt, pred):
        if g == 1 and p == 1:
            tp += 1
        elif g == 0 and p == 0:
            tn += 1
        elif g == 0 and p == 1:
            fp += 1
        else:
            fn += 1

    total = max(len(gt), 1)
    accuracy = (tp + tn) / total
    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-12)
    return {
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "tp": tp,
        "tn": tn,
        "fp": fp,
        "fn": fn,
    }


def main() -> None:
    if not CHECKPOINT_DIR.exists():
        raise FileNotFoundError(f"체크포인트 경로가 없습니다: {CHECKPOINT_DIR}")
    if not TEST_JSONL.exists():
        raise FileNotFoundError(f"테스트 파일이 없습니다: {TEST_JSONL}")

    print("=== Loading model ===")
    model, tokenizer = FastVisionModel.from_pretrained(
        model_name=str(CHECKPOINT_DIR),
        load_in_4bit=True,
    )
    FastVisionModel.for_inference(model)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Device: {device}")
    if device == "cuda":
        print(f"GPU: {torch.cuda.get_device_name(0)}")

    rows = load_test_rows(TEST_JSONL)
    expected_keys = load_expected_keys()
    print(f"Test samples: {len(rows)}")

    all_gt_flat: list[int] = []
    all_pred_flat: list[int] = []
    parsed_count = 0
    per_item_gt: dict[str, list[int]] = {k: [] for k in expected_keys}
    per_item_pred: dict[str, list[int]] = {k: [] for k in expected_keys}
    sample_errors: list[dict[str, Any]] = []

    abs_score_errors: list[int] = []
    signed_score_errors: list[int] = []

    for idx, row in enumerate(rows, start=1):
        sample_id = str(row.get("id", ""))
        image_path = resolve_image_path(str(row.get("image", "")))
        image = Image.open(image_path).convert("RGB")
        gt_items = extract_gt_items(row, expected_keys)
        user_messages = build_user_messages(row)

        prompt = tokenizer.apply_chat_template(
            user_messages,
            add_generation_prompt=True,
        )
        inputs = tokenizer(
            image,
            prompt,
            add_special_tokens=False,
            return_tensors="pt",
        )
        inputs = {k: v.to(device) for k, v in inputs.items()}

        with torch.no_grad():
            generated = model.generate(
                **inputs,
                max_new_tokens=256,
                do_sample=False,
                use_cache=True,
            )

        prompt_tokens = inputs["input_ids"].shape[1]
        output_tokens = generated[0][prompt_tokens:]
        output_text = tokenizer.decode(output_tokens, skip_special_tokens=True).strip()

        parse_ok, pred_items, parse_error = try_parse_predicted_items(output_text, expected_keys)
        if parse_ok:
            parsed_count += 1

        gt_sum = sum(gt_items.values())
        pred_sum = sum(pred_items.values())
        score_error = pred_sum - gt_sum
        signed_score_errors.append(score_error)
        abs_score_errors.append(abs(score_error))

        for k in expected_keys:
            g = gt_items[k]
            p = pred_items[k]
            all_gt_flat.append(g)
            all_pred_flat.append(p)
            per_item_gt[k].append(g)
            per_item_pred[k].append(p)

        sample_errors.append(
            {
                "id": sample_id,
                "parsed_json": parse_ok,
                "parse_error": parse_error if not parse_ok else "",
                "gt_total_score": gt_sum,
                "pred_total_score": pred_sum,
                "score_error": score_error,
            }
        )

        print(
            f"[{idx:02d}/{len(rows)}] id={sample_id} parsed={parse_ok} "
            f"gt={gt_sum} pred={pred_sum} err={score_error}"
        )

    overall = compute_binary_metrics(all_gt_flat, all_pred_flat)

    per_item_metrics: dict[str, dict[str, float]] = {}
    macro_acc = macro_f1 = 0.0
    for key in expected_keys:
        m = compute_binary_metrics(per_item_gt[key], per_item_pred[key])
        per_item_metrics[key] = {
            "accuracy": m["accuracy"],
            "f1": m["f1"],
            "precision": m["precision"],
            "recall": m["recall"],
        }
        macro_acc += m["accuracy"]
        macro_f1 += m["f1"]
    macro_acc /= len(expected_keys)
    macro_f1 /= len(expected_keys)

    parse_rate = parsed_count / len(rows)
    mae_score = sum(abs_score_errors) / max(len(abs_score_errors), 1)
    rmse_score = math.sqrt(sum(e * e for e in signed_score_errors) / max(len(signed_score_errors), 1))
    mean_bias = sum(signed_score_errors) / max(len(signed_score_errors), 1)

    report = {
        "checkpoint_dir": str(CHECKPOINT_DIR),
        "test_file": str(TEST_JSONL),
        "num_samples": len(rows),
        "json_parse": {
            "parsed_count": parsed_count,
            "failed_count": len(rows) - parsed_count,
            "parse_rate": parse_rate,
        },
        "overall_binary_metrics_micro": overall,
        "overall_binary_metrics_macro": {
            "accuracy": macro_acc,
            "f1": macro_f1,
        },
        "total_score_error": {
            "mae": mae_score,
            "rmse": rmse_score,
            "mean_bias_pred_minus_gt": mean_bias,
        },
        "per_item_metrics": per_item_metrics,
        "sample_results": sample_errors,
    }

    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_JSON.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    md_lines = [
        "# Test Evaluation Report",
        "",
        f"- Checkpoint: `{CHECKPOINT_DIR}`",
        f"- Test file: `{TEST_JSONL}`",
        f"- Num samples: **{len(rows)}**",
        "",
        "## JSON Parse",
        f"- Parsed: **{parsed_count}**",
        f"- Failed: **{len(rows) - parsed_count}**",
        f"- Parse rate: **{parse_rate:.4f}**",
        "",
        "## 60-Item Metrics",
        f"- Micro Accuracy: **{overall['accuracy']:.4f}**",
        f"- Micro F1: **{overall['f1']:.4f}**",
        f"- Macro Accuracy: **{macro_acc:.4f}**",
        f"- Macro F1: **{macro_f1:.4f}**",
        "",
        "## Total Score Error (Pred sum - Human sum)",
        f"- MAE: **{mae_score:.4f}**",
        f"- RMSE: **{rmse_score:.4f}**",
        f"- Mean Bias: **{mean_bias:.4f}**",
        "",
        "## Outputs",
        f"- JSON: `{REPORT_JSON}`",
        f"- Markdown: `{REPORT_MD}`",
    ]
    REPORT_MD.write_text("\n".join(md_lines) + "\n", encoding="utf-8")

    print("\n=== Evaluation Done ===")
    print(f"Report JSON: {REPORT_JSON}")
    print(f"Report MD:   {REPORT_MD}")


if __name__ == "__main__":
    main()
