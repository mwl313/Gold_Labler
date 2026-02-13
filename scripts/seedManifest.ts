import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config();

type ManifestImage = {
  id: string;
  age: number;
  path: string;
  split?: "train" | "val" | "test";
};

type Manifest = {
  schema_version: string;
  seed?: number;
  images: ManifestImage[];
};

function readManifest(): Manifest {
  const manifestPath = path.join(process.cwd(), "data", "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `manifest 파일이 없습니다: ${manifestPath}. 먼저 npm run build:manifest 실행이 필요합니다.`,
    );
  }

  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  if (!Array.isArray(parsed.images) || parsed.images.length !== 200) {
    throw new Error("data/manifest.json의 images는 200개여야 합니다.");
  }
  return parsed;
}

function initFirebaseAdmin() {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  if (getApps().length > 0) {
    return getApps()[0];
  }

  if (rawServiceAccount) {
    const serviceAccount = JSON.parse(rawServiceAccount);
    return initializeApp({
      credential: cert(serviceAccount),
      projectId: projectId ?? serviceAccount.project_id,
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId,
  });
}

async function main() {
  const manifest = readManifest();
  initFirebaseAdmin();
  const db = getFirestore();

  await db.collection("manifests").doc("default").set({
    schema_version: manifest.schema_version,
    seed: manifest.seed ?? null,
    images: manifest.images,
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.log(
    `manifests/default 업로드 완료 (images=${manifest.images.length}, seed=${manifest.seed ?? "none"})`,
  );
}

main().catch((error) => {
  console.error("seedManifest 실패:", error);
  process.exit(1);
});
