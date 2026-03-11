import fs from "node:fs";
import path from "node:path";

type Split = "train" | "val" | "test";

type GoldRow = {
  id: string;
  age: number;
  items: Record<string, unknown>;
  split?: string;
  [key: string]: unknown;
};

type ManifestImage = {
  id: string;
  age: number;
  path?: string;
  split?: string;
};

type ManifestDocument = {
  images?: ManifestImage[];
};

type Report = {
  inputPath: string;
  manifestPath: string | null;
  splitSource: "manifest" | "gold_labels" | "stratified";
  totalRecords: number;
  splitCounts: Record<Split, number>;
  ageCounts: Record<string, number>;
  splitAgeCounts: Record<Split, Record<string, number>>;
  duplicateIds: string[];
  manifestMissingInGold: string[];
  goldMissingInManifest: string[];
  missingRequiredFields: {
    id: number;
    age: number;
    items: number;
  };
  splitFieldPresentCount: number;
  itemsMissingKeyRecords: number;
  itemsInvalidValueRecords: number;
  invalidSplitRecords: number;
  unassignedSplitRecords: number;
  outputFiles: {
    withSplit: string;
    train: string;
    val: string;
    test: string;
  };
};

const QUOTAS: Record<number, { train: number; val: number; test: number }> = {
  4: { train: 19, val: 3, test: 5 },
  5: { train: 18, val: 3, test: 5 },
  6: { train: 19, val: 3, test: 6 },
  7: { train: 19, val: 3, test: 6 },
  8: { train: 18, val: 3, test: 5 },
  9: { train: 18, val: 2, test: 5 },
  10: { train: 16, val: 2, test: 4 },
  11: { train: 13, val: 1, test: 4 },
};

const VALID_SPLITS = new Set<Split>(["train", "val", "test"]);

function resolveInputPath(): string {
  const argPath = process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--input="))
    ?.replace("--input=", "");

  const candidates = [
    argPath ? path.resolve(process.cwd(), argPath) : null,
    path.resolve(process.cwd(), "data", "gold_labels.jsonl"),
    path.resolve(process.cwd(), "..", "data", "gold_labels.jsonl"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "gold_labels.jsonl 파일을 찾지 못했습니다. --input=<path> 로 지정하거나 data 폴더에 배치하세요.",
  );
}

function resolveManifestPath(): string | null {
  const argPath = process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--manifest="))
    ?.replace("--manifest=", "");

  const candidates = [
    argPath ? path.resolve(process.cwd(), argPath) : null,
    path.resolve(process.cwd(), "data", "manifest.json"),
    path.resolve(process.cwd(), "..", "data", "manifest.json"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function parseJsonlFile(filePath: string): GoldRow[] {
  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    try {
      const row = JSON.parse(line) as GoldRow;
      return row;
    } catch (error) {
      throw new Error(
        `JSONL 파싱 실패 (${filePath}:${index + 1}) - ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  });
}

function parseManifest(filePath: string): ManifestImage[] {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as ManifestDocument;
  if (!Array.isArray(parsed.images)) {
    throw new Error(`manifest 형식 오류: ${filePath}`);
  }
  return parsed.images.map((image) => ({
    id: String(image.id ?? "").padStart(4, "0"),
    age: Number(image.age),
    path: typeof image.path === "string" ? image.path : undefined,
    split: typeof image.split === "string" ? image.split : undefined,
  }));
}

function extractExpectedItemKeys(): string[] {
  const itemsPath = path.resolve(process.cwd(), "data", "items.ts");
  if (!fs.existsSync(itemsPath)) {
    throw new Error("data/items.ts를 찾지 못했습니다.");
  }

  const source = fs.readFileSync(itemsPath, "utf8");
  const pattern = /key:\s*"([^"]+)"/g;
  const keys: string[] = [];
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match) {
    keys.push(match[1]);
    match = pattern.exec(source);
  }
  return keys;
}

function normalizeId(raw: unknown): string {
  return String(raw ?? "").padStart(4, "0");
}

function normalizeAge(raw: unknown): number {
  return Number(raw);
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(source: T[], seed: number): T[] {
  const random = mulberry32(seed);
  const result = [...source];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function buildStratifiedSplits(rows: GoldRow[]): Map<string, Split> {
  const byAge = new Map<number, GoldRow[]>();
  for (const row of rows) {
    const age = normalizeAge(row.age);
    if (!byAge.has(age)) {
      byAge.set(age, []);
    }
    byAge.get(age)!.push(row);
  }

  const splitMap = new Map<string, Split>();

  for (const [age, quotas] of Object.entries(QUOTAS)) {
    const numericAge = Number(age);
    const rowsForAge = byAge.get(numericAge) ?? [];
    const expectedCount = quotas.train + quotas.val + quotas.test;
    if (rowsForAge.length < expectedCount) {
      throw new Error(
        `층화 분할 실패: age=${numericAge} 데이터 부족 (필요 ${expectedCount}, 실제 ${rowsForAge.length})`,
      );
    }

    const shuffled = shuffle(
      rowsForAge
        .map((row) => ({ ...row, id: normalizeId(row.id) }))
        .sort((a, b) => Number(normalizeId(a.id)) - Number(normalizeId(b.id))),
      20260311 + numericAge,
    );

    const selected = shuffled.slice(0, expectedCount);
    for (let i = 0; i < selected.length; i += 1) {
      const id = normalizeId(selected[i].id);
      if (i < quotas.train) {
        splitMap.set(id, "train");
      } else if (i < quotas.train + quotas.val) {
        splitMap.set(id, "val");
      } else {
        splitMap.set(id, "test");
      }
    }
  }

  return splitMap;
}

function main() {
  const inputPath = resolveInputPath();
  const manifestPath = resolveManifestPath();
  const expectedItemKeys = extractExpectedItemKeys();

  const goldRowsRaw = parseJsonlFile(inputPath);
  const goldRows = goldRowsRaw.map((row) => ({
    ...row,
    id: normalizeId(row.id),
    age: normalizeAge(row.age),
  }));

  const duplicateCounter = new Map<string, number>();
  let missingId = 0;
  let missingAge = 0;
  let missingItems = 0;
  let splitFieldPresentCount = 0;
  let itemsMissingKeyRecords = 0;
  let itemsInvalidValueRecords = 0;
  let invalidSplitRecords = 0;

  for (const row of goldRows) {
    if (!row.id || row.id === "0000") {
      missingId += 1;
    }
    if (!Number.isFinite(row.age)) {
      missingAge += 1;
    }
    if (!row.items || typeof row.items !== "object") {
      missingItems += 1;
    }
    if (typeof row.split === "string") {
      splitFieldPresentCount += 1;
      if (!VALID_SPLITS.has(row.split as Split)) {
        invalidSplitRecords += 1;
      }
    }

    duplicateCounter.set(row.id, (duplicateCounter.get(row.id) ?? 0) + 1);

    const itemsObject =
      row.items && typeof row.items === "object"
        ? (row.items as Record<string, unknown>)
        : {};

    const hasAllKeys = expectedItemKeys.every((key) => key in itemsObject);
    if (!hasAllKeys) {
      itemsMissingKeyRecords += 1;
    }

    const hasInvalidValue = expectedItemKeys.some((key) => {
      const value = itemsObject[key];
      return value !== 0 && value !== 1;
    });
    if (hasInvalidValue) {
      itemsInvalidValueRecords += 1;
    }
  }

  const duplicateIds = [...duplicateCounter.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort((a, b) => Number(a) - Number(b));

  let manifestImages: ManifestImage[] = [];
  let manifestMissingInGold: string[] = [];
  let goldMissingInManifest: string[] = [];
  let splitSource: Report["splitSource"] = "stratified";
  const splitById = new Map<string, Split>();

  if (manifestPath) {
    manifestImages = parseManifest(manifestPath);
    const manifestHasSplit = manifestImages.every((image) =>
      VALID_SPLITS.has(image.split as Split),
    );
    const manifestIds = new Set(manifestImages.map((image) => normalizeId(image.id)));
    const goldIds = new Set(goldRows.map((row) => row.id));

    manifestMissingInGold = [...manifestIds]
      .filter((id) => !goldIds.has(id))
      .sort((a, b) => Number(a) - Number(b));
    goldMissingInManifest = [...goldIds]
      .filter((id) => !manifestIds.has(id))
      .sort((a, b) => Number(a) - Number(b));

    if (manifestHasSplit) {
      splitSource = "manifest";
      for (const image of manifestImages) {
        splitById.set(normalizeId(image.id), image.split as Split);
      }
    }
  }

  if (splitSource !== "manifest") {
    const goldHasValidSplit =
      splitFieldPresentCount === goldRows.length && invalidSplitRecords === 0;
    if (goldHasValidSplit) {
      splitSource = "gold_labels";
      for (const row of goldRows) {
        splitById.set(row.id, row.split as Split);
      }
    } else {
      splitSource = "stratified";
      const generated = buildStratifiedSplits(goldRows);
      for (const [id, split] of generated.entries()) {
        splitById.set(id, split);
      }
    }
  }

  const normalizedRows: Array<Record<string, unknown>> = [];
  let unassignedSplitRecords = 0;

  for (const row of goldRows) {
    const resolvedSplit = splitById.get(row.id);
    if (!resolvedSplit) {
      unassignedSplitRecords += 1;
      continue;
    }
    normalizedRows.push({
      ...row,
      id: row.id,
      age: row.age,
      split: resolvedSplit,
    });
  }

  if (unassignedSplitRecords > 0) {
    throw new Error(
      `split 미할당 레코드가 ${unassignedSplitRecords}개 있습니다. manifest/gold id 일치 여부를 확인하세요.`,
    );
  }

  const splitBuckets: Record<Split, Array<Record<string, unknown>>> = {
    train: [],
    val: [],
    test: [],
  };
  const ageCounts: Record<string, number> = {};
  const splitAgeCounts: Report["splitAgeCounts"] = {
    train: {},
    val: {},
    test: {},
  };

  for (const row of normalizedRows) {
    const split = row.split as Split;
    const ageKey = String(row.age);
    splitBuckets[split].push(row);
    ageCounts[ageKey] = (ageCounts[ageKey] ?? 0) + 1;
    splitAgeCounts[split][ageKey] = (splitAgeCounts[split][ageKey] ?? 0) + 1;
  }

  normalizedRows.sort((a, b) => Number(a.id) - Number(b.id));
  splitBuckets.train.sort((a, b) => Number(a.id) - Number(b.id));
  splitBuckets.val.sort((a, b) => Number(a.id) - Number(b.id));
  splitBuckets.test.sort((a, b) => Number(a.id) - Number(b.id));

  const outputDir = path.resolve(process.cwd(), "data");
  fs.mkdirSync(outputDir, { recursive: true });

  const outWithSplit = path.join(outputDir, "gold_labels_with_split.jsonl");
  const outTrain = path.join(outputDir, "train.jsonl");
  const outVal = path.join(outputDir, "val.jsonl");
  const outTest = path.join(outputDir, "test.jsonl");
  const outReport = path.join(outputDir, "dataset_report.json");

  fs.writeFileSync(
    outWithSplit,
    `${normalizedRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  fs.writeFileSync(
    outTrain,
    `${splitBuckets.train.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  fs.writeFileSync(
    outVal,
    `${splitBuckets.val.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  fs.writeFileSync(
    outTest,
    `${splitBuckets.test.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );

  const report: Report = {
    inputPath,
    manifestPath,
    splitSource,
    totalRecords: normalizedRows.length,
    splitCounts: {
      train: splitBuckets.train.length,
      val: splitBuckets.val.length,
      test: splitBuckets.test.length,
    },
    ageCounts,
    splitAgeCounts,
    duplicateIds,
    manifestMissingInGold,
    goldMissingInManifest,
    missingRequiredFields: {
      id: missingId,
      age: missingAge,
      items: missingItems,
    },
    splitFieldPresentCount,
    itemsMissingKeyRecords,
    itemsInvalidValueRecords,
    invalidSplitRecords,
    unassignedSplitRecords,
    outputFiles: {
      withSplit: outWithSplit,
      train: outTrain,
      val: outVal,
      test: outTest,
    },
  };

  fs.writeFileSync(outReport, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("=== Dataset Preparation Report ===");
  console.log(`Input JSONL: ${report.inputPath}`);
  console.log(`Manifest: ${report.manifestPath ?? "not found"}`);
  console.log(`Split source: ${report.splitSource}`);
  console.log(`Total records: ${report.totalRecords}`);
  console.log(
    `Split counts: train=${report.splitCounts.train}, val=${report.splitCounts.val}, test=${report.splitCounts.test}`,
  );
  console.log(`Age counts: ${JSON.stringify(report.ageCounts)}`);
  console.log(`Duplicate ids: ${report.duplicateIds.length}`);
  console.log(`Manifest missing in gold: ${report.manifestMissingInGold.length}`);
  console.log(`Gold missing in manifest: ${report.goldMissingInManifest.length}`);
  console.log(`Missing required fields(id/age/items): ${missingId}/${missingAge}/${missingItems}`);
  console.log(`Split field present count: ${report.splitFieldPresentCount}`);
  console.log(`Items missing key records: ${report.itemsMissingKeyRecords}`);
  console.log(`Items invalid value records: ${report.itemsInvalidValueRecords}`);
  console.log(`Invalid split records: ${report.invalidSplitRecords}`);
  console.log(`Report file: ${outReport}`);
}

main();
