import fs from "node:fs";
import path from "node:path";

type Split = "train" | "val" | "test";

type GoldRow = {
  id: string;
  age: number;
  split: Split;
  view?: string;
  reviewed?: boolean;
  items: Record<string, unknown>;
  missing?: boolean;
  [key: string]: unknown;
};

type QwenMessage = {
  role: "user" | "assistant";
  content: Array<
    | { type: "image" }
    | {
        type: "text";
        text: string;
      }
  >;
};

type QwenRow = {
  id: string;
  age: number;
  split: Split;
  image: string;
  messages: QwenMessage[];
};

const VALID_SPLITS = new Set<Split>(["train", "val", "test"]);

const USER_PROMPT =
  "이 인물화를 남자척도 01~60 기준으로 채점하라. 설명 없이 오직 JSON 객체만 출력하라. 각 항목 값은 0 또는 1만 사용하고, 반드시 m01_head부터 m60_limb_motion까지 모든 키를 포함하라.";

function resolveInputPath(): string {
  const argInput = process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--input="))
    ?.replace("--input=", "");

  const candidates = [
    argInput ? path.resolve(process.cwd(), argInput) : null,
    path.resolve(process.cwd(), "data", "gold_labels.jsonl"),
    path.resolve(process.cwd(), "..", "data", "gold_labels.jsonl"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "gold_labels.jsonl 파일을 찾지 못했습니다. --input=<path>로 지정하세요.",
  );
}

function extractExpectedItemKeys(): string[] {
  const itemsPath = path.resolve(process.cwd(), "data", "items.ts");
  if (!fs.existsSync(itemsPath)) {
    throw new Error("data/items.ts를 찾지 못했습니다.");
  }

  const source = fs.readFileSync(itemsPath, "utf8");
  const regex = /key:\s*"([^"]+)"/g;
  const keys: string[] = [];
  let match: RegExpExecArray | null = regex.exec(source);
  while (match) {
    keys.push(match[1]);
    match = regex.exec(source);
  }
  if (keys.length !== 60) {
    throw new Error(`items 키 개수가 60이 아닙니다: ${keys.length}`);
  }
  return keys;
}

function parseJsonl(inputPath: string): GoldRow[] {
  const lines = fs
    .readFileSync(inputPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as GoldRow;
    } catch (error) {
      throw new Error(
        `JSONL 파싱 실패 (${inputPath}:${index + 1}) ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  });
}

function normalizeId(value: unknown): string {
  return String(value ?? "").padStart(4, "0");
}

function normalizeItems(
  rawItems: Record<string, unknown>,
  expectedKeys: string[],
): Record<string, 0 | 1> {
  const result: Record<string, 0 | 1> = {};
  for (const key of expectedKeys) {
    const value = rawItems[key];
    if (value !== 0 && value !== 1) {
      throw new Error(`items.${key} 값이 0/1이 아닙니다: ${String(value)}`);
    }
    result[key] = value;
  }
  return result;
}

function main() {
  const inputPath = resolveInputPath();
  const expectedKeys = extractExpectedItemKeys();
  const rows = parseJsonl(inputPath);

  const qwenRows: QwenRow[] = rows.map((row, rowIndex) => {
    const id = normalizeId(row.id);
    const age = Number(row.age);
    const split = row.split;

    if (!Number.isFinite(age)) {
      throw new Error(`age가 유효하지 않습니다: row=${rowIndex + 1}, id=${id}`);
    }
    if (!VALID_SPLITS.has(split)) {
      throw new Error(`split이 유효하지 않습니다: row=${rowIndex + 1}, id=${id}, split=${String(split)}`);
    }
    if (!row.items || typeof row.items !== "object") {
      throw new Error(`items가 없습니다: row=${rowIndex + 1}, id=${id}`);
    }

    const normalizedItems = normalizeItems(
      row.items as Record<string, unknown>,
      expectedKeys,
    );

    return {
      id,
      age,
      split,
      image: `public/images/${age}/${id}.jpg`,
      messages: [
        {
          role: "user",
          content: [
            { type: "image" },
            {
              type: "text",
              text: USER_PROMPT,
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: JSON.stringify(normalizedItems),
            },
          ],
        },
      ],
    };
  });

  qwenRows.sort((a, b) => Number(a.id) - Number(b.id));

  const trainRows = qwenRows.filter((row) => row.split === "train");
  const valRows = qwenRows.filter((row) => row.split === "val");
  const testRows = qwenRows.filter((row) => row.split === "test");

  const outDir = path.resolve(process.cwd(), "data");
  fs.mkdirSync(outDir, { recursive: true });

  const allPath = path.join(outDir, "qwen3vl_sft_all.jsonl");
  const trainPath = path.join(outDir, "qwen3vl_sft_train.jsonl");
  const valPath = path.join(outDir, "qwen3vl_sft_val.jsonl");
  const testPath = path.join(outDir, "qwen3vl_sft_test.jsonl");

  fs.writeFileSync(allPath, `${qwenRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  fs.writeFileSync(trainPath, `${trainRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  fs.writeFileSync(valPath, `${valRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  fs.writeFileSync(testPath, `${testRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

  console.log("=== Qwen3-VL SFT Conversion Complete ===");
  console.log(`Input: ${inputPath}`);
  console.log(`Total: ${qwenRows.length}`);
  console.log(`Train: ${trainRows.length}`);
  console.log(`Val: ${valRows.length}`);
  console.log(`Test: ${testRows.length}`);
  console.log(`All: ${allPath}`);
  console.log(`Train file: ${trainPath}`);
  console.log(`Val file: ${valPath}`);
  console.log(`Test file: ${testPath}`);
}

main();
