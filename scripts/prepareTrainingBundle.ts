import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

type Split = "train" | "val" | "test";

type VlmRow = {
  id?: string;
  age?: number;
  split?: Split;
  image?: string;
  messages?: unknown;
  [key: string]: unknown;
};

type Summary = {
  trainCount: number;
  valCount: number;
  testCount: number;
  imageCount: number;
  missingImageCount: number;
  missingImages: string[];
  zipCreated: boolean;
};

const SPLITS: Split[] = ["train", "val", "test"];
const AGES = ["4", "5", "6", "7", "8", "9", "10", "11"];

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const BUNDLE_DIR = path.join(ROOT, "training_bundle");
const BUNDLE_DATA_DIR = path.join(BUNDLE_DIR, "data");
const BUNDLE_IMAGES_DIR = path.join(BUNDLE_DIR, "images");
const ZIP_PATH = path.join(ROOT, "training_bundle.zip");

function readJsonl(filePath: string): VlmRow[] {
  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as VlmRow;
    } catch (error) {
      throw new Error(
        `JSONL 파싱 실패: ${filePath}:${index + 1} (${error instanceof Error ? error.message : "unknown"})`,
      );
    }
  });
}

function writeJsonl(filePath: string, rows: VlmRow[]) {
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function ensureVlmFiles(): Record<Split, string> {
  const target: Record<Split, string> = {
    train: path.join(DATA_DIR, "train_vlm.jsonl"),
    val: path.join(DATA_DIR, "val_vlm.jsonl"),
    test: path.join(DATA_DIR, "test_vlm.jsonl"),
  };

  const hasAllTarget = SPLITS.every((split) => fs.existsSync(target[split]));
  if (hasAllTarget) {
    return target;
  }

  const qwenSplit: Record<Split, string> = {
    train: path.join(DATA_DIR, "qwen3vl_sft_train.jsonl"),
    val: path.join(DATA_DIR, "qwen3vl_sft_val.jsonl"),
    test: path.join(DATA_DIR, "qwen3vl_sft_test.jsonl"),
  };

  const hasAllQwenSplit = SPLITS.every((split) => fs.existsSync(qwenSplit[split]));
  if (hasAllQwenSplit) {
    for (const split of SPLITS) {
      fs.copyFileSync(qwenSplit[split], target[split]);
    }
    return target;
  }

  const qwenAllPath = path.join(DATA_DIR, "qwen3vl_sft_all.jsonl");
  if (fs.existsSync(qwenAllPath)) {
    const allRows = readJsonl(qwenAllPath);
    const buckets: Record<Split, VlmRow[]> = { train: [], val: [], test: [] };
    for (const row of allRows) {
      const split = row.split;
      if (!split || !SPLITS.includes(split)) {
        throw new Error(
          `qwen3vl_sft_all.jsonl에 split 누락/오류 레코드가 있습니다. id=${String(row.id ?? "unknown")}`,
        );
      }
      buckets[split].push(row);
    }
    for (const split of SPLITS) {
      writeJsonl(target[split], buckets[split]);
    }
    return target;
  }

  throw new Error(
    [
      "필수 파일이 없습니다.",
      "- data/train_vlm.jsonl",
      "- data/val_vlm.jsonl",
      "- data/test_vlm.jsonl",
      "자동 생성에 필요한 qwen3vl_sft_* 파일도 없어 bundle 생성을 중단합니다.",
    ].join("\n"),
  );
}

function normalizeImageRelativePath(raw: string): string {
  const slashed = raw.replace(/\\/g, "/").trim();
  if (!slashed) {
    throw new Error("빈 image 경로");
  }

  if (slashed.startsWith("public/images/")) {
    return slashed.slice("public/".length);
  }
  if (slashed.startsWith("/images/")) {
    return slashed.slice(1);
  }
  if (slashed.startsWith("images/")) {
    return slashed;
  }
  if (slashed.includes("/public/images/")) {
    return slashed.slice(slashed.indexOf("/public/images/") + "/public/".length);
  }

  throw new Error(`지원하지 않는 image 경로 형식: ${raw}`);
}

function collectReferencedImages(vlmFiles: Record<Split, string>) {
  const unique = new Set<string>();
  const missing: string[] = [];
  const splitCounts: Record<Split, number> = { train: 0, val: 0, test: 0 };

  for (const split of SPLITS) {
    const rows = readJsonl(vlmFiles[split]);
    splitCounts[split] = rows.length;

    for (const row of rows) {
      if (typeof row.image !== "string") {
        throw new Error(
          `${path.basename(vlmFiles[split])}에서 image 필드 누락: id=${String(row.id ?? "unknown")}`,
        );
      }
      const rel = normalizeImageRelativePath(row.image);
      unique.add(rel);

      const src = path.join(ROOT, "public", rel.replace(/^images\//, "images/"));
      if (!fs.existsSync(src)) {
        missing.push(rel);
      }
    }
  }

  return {
    imageRelPaths: [...unique].sort(),
    missing: [...new Set(missing)].sort(),
    splitCounts,
  };
}

function resetBundleDirectories() {
  if (fs.existsSync(BUNDLE_DIR)) {
    fs.rmSync(BUNDLE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(BUNDLE_DATA_DIR, { recursive: true });
  fs.mkdirSync(BUNDLE_IMAGES_DIR, { recursive: true });
  for (const age of AGES) {
    fs.mkdirSync(path.join(BUNDLE_IMAGES_DIR, age), { recursive: true });
  }
}

function copyVlmFiles(vlmFiles: Record<Split, string>) {
  fs.copyFileSync(vlmFiles.train, path.join(BUNDLE_DATA_DIR, "train_vlm.jsonl"));
  fs.copyFileSync(vlmFiles.val, path.join(BUNDLE_DATA_DIR, "val_vlm.jsonl"));
  fs.copyFileSync(vlmFiles.test, path.join(BUNDLE_DATA_DIR, "test_vlm.jsonl"));
}

function copyImages(imageRelPaths: string[]) {
  for (const rel of imageRelPaths) {
    const src = path.join(ROOT, "public", rel.replace(/^images\//, "images/"));
    const dest = path.join(BUNDLE_DIR, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function writeReadme(summary: Summary) {
  const content = [
    "# Training Bundle",
    "",
    "이 폴더는 Qwen3-VL 4B 1차 학습용 최소 파일 번들입니다.",
    "",
    "## 포함된 데이터셋 파일",
    "- data/train_vlm.jsonl",
    "- data/val_vlm.jsonl",
    "- data/test_vlm.jsonl",
    "",
    `## 샘플 수`,
    `- train: ${summary.trainCount}`,
    `- val: ${summary.valCount}`,
    `- test: ${summary.testCount}`,
    "",
    `## 이미지 총 개수`,
    `- ${summary.imageCount}`,
    "",
    "## 사용 모델 예정",
    "- Qwen3-VL 4B",
    "",
    "## 비고",
    "- 이 번들은 1차 모델 학습용입니다.",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(BUNDLE_DIR, "README_TRAINING.md"), content, "utf8");
}

function createZip(): boolean {
  if (fs.existsSync(ZIP_PATH)) {
    fs.rmSync(ZIP_PATH, { force: true });
  }

  try {
    const psScript = [
      `$src='${BUNDLE_DIR.replace(/\\/g, "\\\\")}\\*'`,
      `$dst='${ZIP_PATH.replace(/\\/g, "\\\\")}'`,
      "Compress-Archive -Path $src -DestinationPath $dst -Force",
    ].join("; ");

    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`, {
      stdio: "pipe",
    });
    return fs.existsSync(ZIP_PATH);
  } catch {
    return false;
  }
}

function main() {
  const vlmFiles = ensureVlmFiles();
  const { imageRelPaths, missing, splitCounts } = collectReferencedImages(vlmFiles);

  if (missing.length > 0) {
    const preview = missing.slice(0, 20).join(", ");
    throw new Error(
      `참조 이미지 누락 ${missing.length}건. 예시: ${preview}${
        missing.length > 20 ? " ..." : ""
      }`,
    );
  }

  resetBundleDirectories();
  copyVlmFiles(vlmFiles);
  copyImages(imageRelPaths);

  const summary: Summary = {
    trainCount: splitCounts.train,
    valCount: splitCounts.val,
    testCount: splitCounts.test,
    imageCount: imageRelPaths.length,
    missingImageCount: missing.length,
    missingImages: missing,
    zipCreated: false,
  };

  writeReadme(summary);
  summary.zipCreated = createZip();

  console.log("=== Training Bundle Summary ===");
  console.log(`train/val/test: ${summary.trainCount}/${summary.valCount}/${summary.testCount}`);
  console.log(`copied images: ${summary.imageCount}`);
  console.log(`missing images: ${summary.missingImageCount}`);
  console.log(`zip created: ${summary.zipCreated ? "YES" : "NO"}`);
  console.log(`bundle dir: ${BUNDLE_DIR}`);
  console.log(`zip path: ${ZIP_PATH}`);
}

main();
