import fs from "node:fs";
import path from "node:path";

type Age = 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
type Split = "train" | "val" | "test";

type ManifestImage = {
  id: string;
  age: Age;
  path: string;
  split: Split;
};

type Manifest = {
  schema_version: "dap_male_v1";
  seed: number;
  images: ManifestImage[];
};

const DEFAULT_SEED = 20260213;
const AGES: Age[] = [4, 5, 6, 7, 8, 9, 10, 11];

const SAMPLE_COUNTS: Record<Age, number> = {
  4: 27,
  5: 26,
  6: 28,
  7: 28,
  8: 26,
  9: 25,
  10: 22,
  11: 18,
};

const SPLIT_COUNTS: Record<Age, { train: number; val: number; test: number }> = {
  4: { train: 19, val: 3, test: 5 },
  5: { train: 18, val: 3, test: 5 },
  6: { train: 19, val: 3, test: 6 },
  7: { train: 19, val: 3, test: 6 },
  8: { train: 18, val: 3, test: 5 },
  9: { train: 18, val: 2, test: 5 },
  10: { train: 16, val: 2, test: 4 },
  11: { train: 13, val: 1, test: 4 },
};

function readSeedFromArgs(argv: string[]): number {
  const seedArg = argv.find((arg) => arg.startsWith("--seed="));
  if (!seedArg) {
    return DEFAULT_SEED;
  }
  const value = Number(seedArg.replace("--seed=", ""));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`잘못된 seed입니다: ${seedArg}`);
  }
  return value;
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

function hashSeed(seed: number, age: Age): number {
  const mixed = seed ^ (age * 2654435761);
  return mixed >>> 0;
}

function shuffle<T>(source: T[], random: () => number): T[] {
  const result = [...source];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function listJpgIds(ageDir: string): string[] {
  if (!fs.existsSync(ageDir)) {
    throw new Error(`폴더가 없습니다: ${ageDir}`);
  }
  return fs
    .readdirSync(ageDir)
    .filter((file) => /^\d{4}\.jpg$/i.test(file))
    .map((file) => file.slice(0, 4))
    .sort((a, b) => Number(a) - Number(b));
}

function buildAgeSelection(seed: number, age: Age): ManifestImage[] {
  const ageDir = path.join(process.cwd(), "public", "images", String(age));
  const ids = listJpgIds(ageDir);
  const requiredCount = SAMPLE_COUNTS[age];
  if (ids.length < requiredCount) {
    throw new Error(
      `age=${age} 폴더 파일 부족: 필요 ${requiredCount}, 실제 ${ids.length}`,
    );
  }

  const random = mulberry32(hashSeed(seed, age));
  const selected = shuffle(ids, random).slice(0, requiredCount);
  const splits = SPLIT_COUNTS[age];

  return selected.map((id, index) => {
    let split: Split = "test";
    if (index < splits.train) {
      split = "train";
    } else if (index < splits.train + splits.val) {
      split = "val";
    }
    return {
      id,
      age,
      path: `/images/${age}/${id}.jpg`,
      split,
    };
  });
}

function validateCounts(images: ManifestImage[]) {
  if (images.length !== 200) {
    throw new Error(`총 이미지 수가 200이 아닙니다: ${images.length}`);
  }

  const splitTotals = images.reduce(
    (acc, image) => {
      acc[image.split] += 1;
      return acc;
    },
    { train: 0, val: 0, test: 0 },
  );

  if (splitTotals.train !== 140 || splitTotals.val !== 20 || splitTotals.test !== 40) {
    throw new Error(
      `split 합계 오류: train=${splitTotals.train}, val=${splitTotals.val}, test=${splitTotals.test}`,
    );
  }
}

function printSummary(images: ManifestImage[]) {
  const byAge = new Map<Age, { total: number; train: number; val: number; test: number }>();
  for (const age of AGES) {
    byAge.set(age, { total: 0, train: 0, val: 0, test: 0 });
  }
  for (const row of images) {
    const stats = byAge.get(row.age);
    if (!stats) continue;
    stats.total += 1;
    stats[row.split] += 1;
  }

  console.log("Manifest 생성 요약");
  for (const age of AGES) {
    const stats = byAge.get(age)!;
    console.log(
      `age ${age}: total=${stats.total}, train=${stats.train}, val=${stats.val}, test=${stats.test}`,
    );
  }
}

function main() {
  const seed = readSeedFromArgs(process.argv.slice(2));

  const images = AGES.flatMap((age) => buildAgeSelection(seed, age)).sort(
    (a, b) => Number(a.id) - Number(b.id),
  );

  validateCounts(images);

  const manifest: Manifest = {
    schema_version: "dap_male_v1",
    seed,
    images,
  };

  const dataDir = path.join(process.cwd(), "data");
  const manifestPath = path.join(dataDir, "manifest.json");

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  printSummary(images);
  console.log(`생성 완료: ${manifestPath}`);
}

main();
