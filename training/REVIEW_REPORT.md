# Review Report — Qwen3-VL 8B QLoRA Training/Eval Scripts

**Date:** 2026-08-18
**Scope:** `training/train_qwen3vl_8b.py` and `training/eval_qwen3vl_8b.py`
**Assumed environment:** RunPod GPU (BF16-capable), current `unsloth` + `transformers` + `trl` + `peft` (August 2026).

Data loading was pre-verified and is out of scope (jsonl format, image path resolution, GT JSON parsing, 60 keys in `items.ts`).

## TL;DR

- **No hard BLOCKER** (no crash-on-import / crash-on-startup). The core API usage is valid and matches the official Unsloth vision fine-tuning docs exactly.
- Three **MAJOR** issues silently degrade results:
  1. `max_new_tokens=256` is too small for a 60-key JSON output → truncated JSON → parse failures → eval metrics collapse.
  2. `max_length=2048` in `SFTConfig` is a no-op when `skip_prepare_dataset=True` + `UnslothVisionDataCollator` is used → truncation intent is silently ignored.
  3. `train_on_responses_only` is not enabled → loss is computed over the user instruction and vision tokens, not just the assistant JSON.
- Several MINOR hygiene/robustness issues.

---

## MAJOR

### M1 — `max_new_tokens=256` is insufficient for 60-key JSON output
- **Location:** `training/eval_qwen3vl_8b.py:217` (`max_new_tokens=256` inside `model.generate(...)`).
- **Why it fails:** The ground-truth assistant response is a single compact JSON object with 60 keys (e.g. `{"m01_head":1,"m02_neck":0,...}`), ~1350 characters. Tokenized, 60 entries × ~5–6 tokens each (quotes, colons, commas, key subwords) is ~350–450 tokens, plus braces. `256` will cut generation off mid-JSON on nearly every sample.
- **Impact:** `try_parse_predicted_items` fails to parse the truncated output → `pred_items` becomes all-zero → `parse_rate ≈ 0`, micro/macro metrics collapse to the all-negative baseline, and `total_score_error` is dominated by `-gt_sum`. The report looks catastrophic even if the model is fine.
- **Fix:**
  ```python
  max_new_tokens=1024,   # comfortable headroom for 60 keys; 512 is a safe minimum
  ```
  Optionally keep a retry/repair: if parse fails, do a second `generate` with a higher `max_new_tokens`.

### M2 — `max_length=2048` is a silent no-op with `skip_prepare_dataset=True`
- **Location:** `training/train_qwen3vl_8b.py:239-240` (`dataset_kwargs={"skip_prepare_dataset": True}` + `max_length=MAX_LENGTH`).
- **Why it fails:** `SFTTrainer` only applies `args.max_length` inside `_prepare_dataset()` (its own tokenization path). With `skip_prepare_dataset=True` that step is skipped, so `max_length=2048` never reaches any tokenizer call. Tokenization is instead done by `UnslothVisionDataCollator`, whose own `max_seq_length` parameter defaults to `None` and is only populated from `FastVisionModel.from_pretrained(max_seq_length=...)` — which the script does not set (see `load_model()` at `train_qwen3vl_8b.py:159`).
- **Impact:** Sequences are not truncated to 2048 as intended. Combined with the model default context (far above 2048), image tokens (dynamic resolution) plus ~400 text tokens produce untruncated sequences — slower steps, potential OOM at batch=1 on 8B, and no guarantee the assistant JSON stays within a bounded window.
- **Fix (pick one):**
  ```python
  # A) Let the collator truncate — set on the model, not the trainer:
  model, tokenizer = FastVisionModel.from_pretrained(..., max_seq_length=MAX_LENGTH)
  # and/or pass to the collator directly:
  UnslothVisionDataCollator(model, tokenizer, max_seq_length=MAX_LENGTH)
  ```
  ```python
  # B) Control image resolution explicitly so sequence length is predictable:
  model, tokenizer = FastVisionModel.from_pretrained(...)
  # then use the processor's min_pixels / max_pixels to bound vision tokens
  # (Unsloth also exposes a `resize="min"` default on the collator).
  ```

### M3 — Loss is not restricted to the assistant response (`train_on_responses_only` not set)
- **Location:** `training/train_qwen3vl_8b.py:248` (`data_collator=UnslothVisionDataCollator(model, tokenizer)`).
- **Why it degrades training:** `UnslothVisionDataCollator` defaults to `train_on_responses_only=False`. Only `completion_only_loss=True` (the default) masks *padding* vision tokens; the user instruction text and the non-padding vision tokens still contribute to the cross-entropy loss. For a task whose entire label is a JSON string, the model is trained to also reproduce the instruction and image tokens, which typically worsens JSON-output/instruction-following quality.
- **Fix:** mask to the assistant turn:
  ```python
  data_collator=UnslothVisionDataCollator(
      model,
      tokenizer,
      train_on_responses_only=True,
      instruction_part="<|im_start|>user\n",
      response_part="<|im_start|>assistant\n",
  )
  ```
  (Adjust the markers to the actual Qwen3-VL chat-template delimiters; the defaults above are the standard Qwen chat delimiters.)

---

## MINOR

### m1 — Eval loads a LoRA-adapter directory via `FastVisionModel.from_pretrained`
- **Location:** `training/eval_qwen3vl_8b.py:171-174`.
- **Why:** `trainer.save_model()` (via `train_qwen3vl_8b.py:264`) saves only the PEFT adapter (`adapter_config.json` + `adapter_model.safetensors`), not the base weights. Unsloth's `from_pretrained` can reconstruct the model from `base_model_name_or_path` in `adapter_config.json`, but this requires the base model to still be downloadable on the eval box and the same Unsloth version.
- **Fix:** Prefer an explicit, portable load, or a merged save:
  ```python
  # more robust eval-side load:
  model, tokenizer = FastVisionModel.from_pretrained(BASE_MODEL_NAME, load_in_4bit=True)
  model = PeftModel.from_pretrained(model, CHECKPOINT_DIR)
  FastVisionModel.for_inference(model)
  # or, at train time, save a merged checkpoint:
  model.save_pretrained_merged(str(OUTPUT_DIR / "merged"), tokenizer, save_method="merged_4bit")
  ```

### m2 — Parse-failure samples are scored as all-zero predictions
- **Location:** `training/eval_qwen3vl_8b.py:125-126` (`return False, {k: 0 for k in expected_keys}, parse_error`).
- **Why:** On parse failure, `pred_items` is all zeros, so `pred_sum=0` and the per-sample `score_error` becomes `-gt_sum`. This conflates "model couldn't output valid JSON" with "model predicted all zeros", inflating MAE/RMSE and biasing `mean_bias` negative.
- **Fix:** Exclude unparseable samples from `abs_score_errors`/`signed_score_errors` (or record them separately), and clearly separate "parse failure" from "valid prediction" in the report.

### m3 — `test_ds` loaded but unused in the training script
- **Location:** `training/train_qwen3vl_8b.py:190` (`test_ds = load_jsonl_dataset(TEST_JSONL, "test")`).
- **Why:** Loaded (and images decoded into memory) but never used; test evaluation is the eval script's job. Minor memory waste. Either drop it or keep only a count.

### m4 — Redundant tokenizer save
- **Location:** `training/train_qwen3vl_8b.py:264-265`.
- **Why:** `trainer.save_model()` already saves the processor/tokenizer; the subsequent `tokenizer.save_pretrained()` is harmless but redundant.

### m5 — `estimate_total_steps`/warmup only approximate
- **Location:** `training/train_qwen3vl_8b.py:175-178, 218`.
- **Why:** Fine for a warmup heuristic; just note it assumes a full epoch partition and doesn't account for any scheduler-based epoch flooring. Non-issue at runtime.

---

## Confirmed-valid API usage (checked against Unsloth vision docs)

These were flagged for review and are **correct** — no change needed:

1. **Eval tokenizer call** — `tokenizer(image, prompt, add_special_tokens=False, return_tensors="pt")` at `eval_qwen3vl_8b.py:207-211` matches the official Unsloth inference pattern exactly (positional order = `images`, `text`; `add_special_tokens=False` avoids double BOS/EOS). ✅
2. **`FastVisionModel.get_peft_model` signature** — `r, lora_alpha, lora_dropout, bias, random_state, use_rslora, loftq_config` at `train_qwen3vl_8b.py:198-211` matches the current documented signature (`use_rslora` and `loftq_config` are still accepted). ✅
3. **`from_pretrained(load_in_4bit=True, use_gradient_checkpointing="unsloth")`, `for_training`, `for_inference`** — all valid current Unsloth `FastVisionModel` calls. ✅
4. **`apply_chat_template` with an image placeholder** — `build_user_messages` returning `[{"role":"user","content":[{"type":"image"}, {"type":"text",...}]}]` (image item has *no* `image` field) is exactly the documented Qwen3-VL inference convention; the image is supplied separately to the processor. ✅
5. **`SFTConfig` args** — `dataset_text_field=""`, `dataset_kwargs={"skip_prepare_dataset": True}`, `eval_strategy="epoch"` are all valid. `eval_strategy` (not the deprecated `evaluation_strategy`) is the correct current name. ✅
6. **`SFTTrainer(processing_class=tokenizer, ...)`** — `processing_class` is the current TRL parameter name. ✅
7. **`from unsloth import FastVisionModel` / `from unsloth.trainer import UnslothVisionDataCollator`** — correct imports. ✅
8. **Prompt-length slicing for decoding** — `prompt_tokens = inputs["input_ids"].shape[1]` then `generated[0][prompt_tokens:]` is correct for batch size 1. ✅

---

## Recommended change priority

1. `max_new_tokens` → 1024 (eval correctness).
2. Bound sequence length via `max_seq_length` / `min_pixels`–`max_pixels` (training stability/memory).
3. `train_on_responses_only=True` (training quality).
4. Apply the MINOR robustness fixes (m1–m4).
