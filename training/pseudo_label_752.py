import argparse
import json
import re
import time
from pathlib import Path
from typing import Any

# NOTE: unsloth / torch / PIL / peft 는 여기서 import 하지 않는다.
# --dry-run 은 (로컬 Mac 등 GPU 없는 환경에서) 모델 없이 실행되어야 하므로,
# 실제 모델 로드가 필요한 함수 내부에서 지연 import 한다.

REPO_ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT_DIR = REPO_ROOT / "training" / "output" / "qwen3vl_8b_run1"
MANIFEST_JSON = REPO_ROOT / "data" / "manifest.json"
ITEMS_TS = REPO_ROOT / "data" / "items.ts"
IMAGES_ROOT = REPO_ROOT / "images"

OUTPUT_JSONL = REPO_ROOT / "data" / "pseudo_labels_752.jsonl"
REPORT_JSON = REPO_ROOT / "data" / "pseudo_labels_752_report.json"

DRYRUN_OUTPUT_JSONL = REPO_ROOT / "data" / "pseudo_labels_752_dryrun.jsonl"
DRYRUN_REPORT_JSON = REPO_ROOT / "data" / "pseudo_labels_752_dryrun_report.json"

# B-2 결정사항: 샘플링 앙상블 (3회, 항목별 동의율)
NUM_ATTEMPTS = 3
BASE_SEED = 3407
MAX_NEW_TOKENS = 1024
TEMPERATURE = 0.3
TOP_P = 0.9
DEFAULT_BATCH_SIZE = 8

# train/eval과 동일한 채점 프롬프트 텍스트 (qwen3vl_sft_*.jsonl 의 user 텍스트와 동일)
SCORING_PROMPT = (
    "이 인물화를 남자척도 01~60 기준으로 채점하라. 설명 없이 오직 JSON 객체만 출력하라. "
    "각 항목 값은 0 또는 1만 사용하고, 반드시 m01_head부터 m60_limb_motion까지 모든 키를 포함하라."
)


def load_expected_keys() -> list[str]:
    items_ts = REPO_ROOT / "data" / "items.ts"
    if not items_ts.exists():
        raise FileNotFoundError(f"items 정의 파일을 찾지 못했습니다: {items_ts}")

    source = items_ts.read_text(encoding="utf-8")
    keys = re.findall(r'key:\s*"([^"]+)"', source)
    if len(keys) != 60:
        raise ValueError(f"items 키 개수가 60이 아닙니다: {len(keys)}")
    return keys


def load_manifest() -> dict[str, Any]:
    if not MANIFEST_JSON.exists():
        raise FileNotFoundError(f"manifest 파일을 찾지 못했습니다: {MANIFEST_JSON}")

    data = json.loads(MANIFEST_JSON.read_text(encoding="utf-8"))
    images = data.get("images", [])
    gold_ids = {str(img["id"]) for img in images}
    test_ids = {str(img["id"]) for img in images if img.get("split") == "test"}
    return {"gold_ids": gold_ids, "test_ids": test_ids, "images": images}


def build_target_list(gold_ids: set[str], test_ids: set[str]) -> list[dict[str, Any]]:
    """images/{age}/{id}.jpg 전체에서 골드 200장을 제외한 대상 목록을 만든다."""
    targets: list[dict[str, Any]] = []
    for p in sorted(IMAGES_ROOT.glob("*/*.jpg")):
        sample_id = p.stem
        if sample_id in gold_ids:
            continue
        age = int(p.parent.name)
        targets.append(
            {
                "id": sample_id,
                "age": age,
                "image": f"images/{age}/{sample_id}.jpg",
                "path": str(p),
            }
        )

    # test split(40장) id는 골드 200장에 전부 포함되어야 한다 (전제 확인).
    assert test_ids <= gold_ids, "test split id가 골드 목록에 포함되지 않았습니다."

    # 안전 검증: 대상 목록에 골드 id 또는 test split id가 섞이면 안 된다.
    for t in targets:
        assert t["id"] not in gold_ids, f"골드 id가 대상 목록에 포함됨: {t['id']}"
        assert t["id"] not in test_ids, f"test split id가 대상 목록에 포함됨: {t['id']}"

    return targets


def load_completed_ids(output_jsonl: Path) -> set[str]:
    if not output_jsonl.exists():
        return set()
    ids: set[str] = set()
    with output_jsonl.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ids.add(str(json.loads(line)["id"]))
            except (json.JSONDecodeError, KeyError, TypeError):
                continue
    return ids


def append_result(output_jsonl: Path, record: dict[str, Any]) -> None:
    # append 모드 + flush: 중간에 죽어도 처리 완료분은 보존된다.
    with output_jsonl.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
        f.flush()


def try_parse_predicted_items(
    text: str,
    expected_keys: list[str],
) -> tuple[bool, dict[str, int], str]:
    """eval_qwen3vl_8b.py 의 try_parse_predicted_items 로직 재사용 (fence/중괄호 폴백)."""
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

    normalized: dict[str, int] = {}
    for key in expected_keys:
        value = parsed_obj.get(key, 0)
        normalized[key] = 1 if value == 1 else 0
    return True, normalized, ""


def aggregate_ensemble(
    parses: list[dict[str, int]],
    expected_keys: list[str],
) -> tuple[dict[str, int], dict[str, float], int, int, bool, bool]:
    """3회 시도 결과를 다수결 + 동의율(confidence)로 집계한다.

    - final 값 = 다수결 (3회 성공 시 2:1 이상, 2회 성공 시 2:0 또는 1:1→0)
    - confidence_k = 동의율 (1.0 / 0.67 / 0.5 / 0.33)
    - 파싱 성공 <= 1회 → needs_review=true, items는 성공분(1회면 그 값), confidence 전부 0.33
    - 어느 항목이든 confidence < 1.0 → has_low_confidence=true
    """
    n = len(parses)
    items: dict[str, int] = {k: 0 for k in expected_keys}
    confidence: dict[str, float] = {k: 0.0 for k in expected_keys}
    agree_full = 0

    if n >= 2:
        for k in expected_keys:
            ones = sum(p.get(k, 0) for p in parses)
            if ones == 0 or ones == n:
                items[k] = 1 if ones == n else 0
                confidence[k] = 1.0
                agree_full += 1
            else:
                # 이견 발생: 다수결, confidence는 다수 의견 비율 (2/3→0.67, 1/2→0.5)
                items[k] = 1 if ones * 2 > n else 0
                confidence[k] = round(max(ones, n - ones) / n, 2)
    else:
        # n == 0 또는 1: 단일 시도(또는 전무) → needs_review, confidence 전부 0.33
        for k in expected_keys:
            items[k] = parses[0].get(k, 0) if n == 1 else 0
            confidence[k] = 0.33

    needs_review = n <= 1
    has_low_confidence = any(confidence[k] < 1.0 for k in expected_keys)
    # agree_full: 전원 동의한 항목 수 (3회 성공 시 "3 of 3 동의" 항목 수와 동일)
    return items, confidence, n, agree_full, needs_review, has_low_confidence


def make_record(
    target: dict[str, Any],
    items: dict[str, int],
    confidence: dict[str, float],
    parse_ok_count: int,
    agree_3of3_count: int,
    needs_review: bool,
    has_low_confidence: bool,
) -> dict[str, Any]:
    return {
        "id": target["id"],
        "age": target["age"],
        "image": target["image"],
        "items": items,
        "confidence": confidence,
        "parse_ok_count": parse_ok_count,
        "agree_3of3_count": agree_3of3_count,
        "needs_review": needs_review,
        "has_low_confidence": has_low_confidence,
        "pred_total_score": int(sum(items.values())),
    }


def build_scoring_messages() -> list[dict[str, Any]]:
    # train/eval 데이터셋과 동일한 messages 구조 (user content: image + text)
    return [
        {
            "role": "user",
            "content": [
                {"type": "image"},
                {"type": "text", "text": SCORING_PROMPT},
            ],
        }
    ]


def load_checkpoint_model():
    """eval_qwen3vl_8b.py 의 load_checkpoint_model() 패턴 그대로 재사용."""
    from unsloth import FastVisionModel  # noqa: F401 (지연 import)
    from peft import PeftModel

    adapter_config_path = CHECKPOINT_DIR / "adapter_config.json"
    if adapter_config_path.exists():
        try:
            adapter_config = json.loads(adapter_config_path.read_text(encoding="utf-8"))
            base_model_name = adapter_config.get("base_model_name_or_path")
            if base_model_name:
                print(f"[Model] adapter config의 base model 로드: {base_model_name}")
                model, tokenizer = FastVisionModel.from_pretrained(
                    model_name=base_model_name,
                    load_in_4bit=True,
                )
                model = PeftModel.from_pretrained(model, str(CHECKPOINT_DIR))
                FastVisionModel.for_inference(model)
                return model, tokenizer
        except Exception as e:
            print(f"[Model] PEFT 로드 실패, FastVisionModel 직접 로드로 폴백: {e}")

    print(f"[Model] FastVisionModel 직접 로드: {CHECKPOINT_DIR}")
    model, tokenizer = FastVisionModel.from_pretrained(
        model_name=str(CHECKPOINT_DIR),
        load_in_4bit=True,
    )
    FastVisionModel.for_inference(model)
    return model, tokenizer


def make_dummy_record(target: dict[str, Any], expected_keys: list[str]) -> dict[str, Any]:
    """--dry-run 전용: 가짜 items/confidence (결정적, id 기반)."""
    id_num = int(target["id"]) if target["id"].isdigit() else 0
    items: dict[str, int] = {}
    confidence: dict[str, float] = {}
    for i, k in enumerate(expected_keys):
        items[k] = 1 if (id_num + i) % 5 == 0 else 0
        confidence[k] = 1.0
    return make_record(target, items, confidence, 3, 60, False, False)


def run_dry(
    targets: list[dict[str, Any]],
    expected_keys: list[str],
    output_jsonl: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """모델 없이 더미 레코드를 생성한다. 성공/실패 통계를 맞춰 반환."""
    written: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for idx, target in enumerate(targets, start=1):
        # 경로 존재 검증 (실제 inference 전 목록 유효성 확인)
        if not Path(target["path"]).exists():
            failed.append({"id": target["id"], "error": "이미지 파일 없음"})
            continue
        record = make_dummy_record(target, expected_keys)
        append_result(output_jsonl, record)
        written.append(record)
        print(
            f"[{idx:03d}/{len(targets)}] id={target['id']} (dry-run) "
            f"score={record['pred_total_score']}",
            flush=True,
        )
    return written, failed


def run_inference(
    targets: list[dict[str, Any]],
    expected_keys: list[str],
    output_jsonl: Path,
    batch_size: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int, int]:
    """배치 추론 + 3회 샘플링 앙상블. (written, failed, parse_ok_attempts, total_attempts)"""
    import torch
    from PIL import Image

    model, tokenizer = load_checkpoint_model()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Device: {device}")
    if device == "cuda":
        print(f"GPU: {torch.cuda.get_device_name(0)}")

    scoring_prompt = tokenizer.apply_chat_template(
        build_scoring_messages(),
        add_generation_prompt=True,
    )

    written: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    parse_ok_attempts = 0
    total_attempts = 0
    processed = 0

    for start in range(0, len(targets), batch_size):
        batch = targets[start : start + batch_size]
        # 이미지 로딩: 실패한 샘플은 failed로 분리하고 배치에서 제외한다.
        images: list[Any] = []
        valid_batch: list[dict[str, Any]] = []
        for t in batch:
            try:
                images.append(Image.open(t["path"]).convert("RGB"))
                valid_batch.append(t)
            except Exception as e:
                failed.append({"id": t["id"], "error": f"이미지 로드 실패: {e}"})

        if not valid_batch:
            continue

        # 샘플별 성공 파싱 누적
        parses_per_sample: list[list[dict[str, int]]] = [[] for _ in valid_batch]

        for attempt in range(NUM_ATTEMPTS):
            seed = BASE_SEED + attempt
            torch.manual_seed(seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(seed)

            total_attempts += len(valid_batch)
            try:
                texts = [scoring_prompt] * len(valid_batch)
                inputs = tokenizer(
                    images=images,
                    text=texts,
                    add_special_tokens=False,
                    return_tensors="pt",
                    padding=True,
                )
                inputs = {k: v.to(device) for k, v in inputs.items()}

                with torch.inference_mode():
                    generated = model.generate(
                        **inputs,
                        max_new_tokens=MAX_NEW_TOKENS,
                        do_sample=True,
                        temperature=TEMPERATURE,
                        top_p=TOP_P,
                        use_cache=True,
                    )

                for i in range(len(valid_batch)):
                    output_text = tokenizer.decode(
                        generated[i].tolist(),
                        skip_special_tokens=True,
                    ).strip()
                    ok, items, _err = try_parse_predicted_items(output_text, expected_keys)
                    if ok:
                        parses_per_sample[i].append(items)
                        parse_ok_attempts += 1
            except Exception as e:
                # 배치 단위 실패: 이 시도의 파싱은 전부 실패로 간주하고 다음 시도로 넘어간다.
                print(f"[WARN] attempt={attempt} 생성 실패: {e}", flush=True)

        for target, parses in zip(valid_batch, parses_per_sample):
            items, confidence, parse_ok_count, agree, needs_review, low_conf = (
                aggregate_ensemble(parses, expected_keys)
            )
            record = make_record(
                target, items, confidence, parse_ok_count, agree, needs_review, low_conf
            )
            append_result(output_jsonl, record)
            written.append(record)
            processed += 1
            print(
                f"[{processed:03d}/{len(targets)}] id={target['id']} "
                f"parse_ok={parse_ok_count}/{NUM_ATTEMPTS} "
                f"score={record['pred_total_score']} "
                f"review={needs_review} low_conf={low_conf}",
                flush=True,
            )

    return written, failed, parse_ok_attempts, total_attempts


def load_all_records(output_jsonl: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if not output_jsonl.exists():
        return records
    with output_jsonl.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def build_report(
    output_jsonl: Path,
    report_json: Path,
    dry_run: bool,
    total_target: int,
    skipped_resume: int,
    failed: list[dict[str, Any]],
    parse_ok_attempts: int,
    total_attempts: int,
    expected_keys: list[str],
    elapsed_seconds: float,
) -> dict[str, Any]:
    records = load_all_records(output_jsonl)

    needs_review_count = sum(1 for r in records if r.get("needs_review"))
    low_conf_count = sum(1 for r in records if r.get("has_low_confidence"))

    per_item_conf_sum: dict[str, float] = {k: 0.0 for k in expected_keys}
    per_item_conf_count: dict[str, int] = {k: 0 for k in expected_keys}
    for r in records:
        conf = r.get("confidence", {})
        for k in expected_keys:
            v = conf.get(k)
            if isinstance(v, (int, float)):
                per_item_conf_sum[k] += float(v)
                per_item_conf_count[k] += 1
    per_item_mean_conf = {
        k: (per_item_conf_sum[k] / per_item_conf_count[k] if per_item_conf_count[k] else 0.0)
        for k in expected_keys
    }

    parse_rate = (parse_ok_attempts / total_attempts) if total_attempts else 0.0

    report = {
        "output_file": str(output_jsonl),
        "checkpoint_dir": str(CHECKPOINT_DIR),
        "dry_run": dry_run,
        "total_target": total_target,
        "resumed_skipped": skipped_resume,
        "failed_count": len(failed),
        "failed_ids": failed,
        "total_written": len(records),
        "parse": {
            "parse_ok_attempts": parse_ok_attempts,
            "total_attempts": total_attempts,
            "parse_rate": parse_rate,
        },
        "needs_review_count": needs_review_count,
        "has_low_confidence_count": low_conf_count,
        "per_item_mean_confidence": per_item_mean_conf,
        "elapsed_seconds": round(elapsed_seconds, 2),
    }

    report_json.write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Phase B: 752장 자동채점 (3회 샘플링 앙상블 pseudo-labeling)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="모델 로드 없이 더미 items/confidence 생성 (로컬 Mac에서도 실행 가능)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="앞 N장만 처리 (RunPod 스모크 테스트용)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"배치 크기 (기본 {DEFAULT_BATCH_SIZE})",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    output_jsonl = DRYRUN_OUTPUT_JSONL if args.dry_run else OUTPUT_JSONL
    report_json = DRYRUN_REPORT_JSON if args.dry_run else REPORT_JSON

    expected_keys = load_expected_keys()
    manifest = load_manifest()
    gold_ids: set[str] = manifest["gold_ids"]
    test_ids: set[str] = manifest["test_ids"]

    targets = build_target_list(gold_ids, test_ids)
    if args.limit is not None:
        targets = targets[: args.limit]

    completed = load_completed_ids(output_jsonl)
    todo = [t for t in targets if t["id"] not in completed]
    skipped_resume = len(targets) - len(todo)

    print(f"[Target] 전체 대상: {len(targets)}장")
    print(f"[Resume] 기존 출력에서 완료된 id {skipped_resume}개 스킵, 이번 실행 {len(todo)}장")
    print(f"[Output] {output_jsonl}")

    start_time = time.time()

    if args.dry_run:
        written, failed = run_dry(todo, expected_keys, output_jsonl)
        parse_ok_attempts = len(written) * NUM_ATTEMPTS
        total_attempts = len(written) * NUM_ATTEMPTS
    else:
        if not CHECKPOINT_DIR.exists():
            raise FileNotFoundError(f"체크포인트 경로가 없습니다: {CHECKPOINT_DIR}")
        written, failed, parse_ok_attempts, total_attempts = run_inference(
            todo, expected_keys, output_jsonl, args.batch_size
        )

    elapsed = time.time() - start_time

    report = build_report(
        output_jsonl,
        report_json,
        args.dry_run,
        len(targets),
        skipped_resume,
        failed,
        parse_ok_attempts,
        total_attempts,
        expected_keys,
        elapsed,
    )

    print("\n=== Phase B Done ===")
    print(f"작성 레코드: {len(written)} / 실패: {len(failed)}")
    print(f"전체 출력 레코드: {report['total_written']}")
    print(f"needs_review: {report['needs_review_count']}")
    print(f"has_low_confidence: {report['has_low_confidence_count']}")
    print(f"소요 시간: {report['elapsed_seconds']}초")
    print(f"Report JSON: {report_json}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("\n[ERROR] pseudo_label_752 실행 실패")
        print(f"- message: {e}")
        raise
