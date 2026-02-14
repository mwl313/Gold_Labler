import {
  DocumentData,
  Timestamp,
  Unsubscribe,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  onSnapshot,
} from "firebase/firestore";
import { items, createEmptyItems, ItemKey, ViewType, VIEW_OPTIONS } from "@/data/items";
import { getFirestoreDb } from "@/lib/firebase";

export type ManifestSplit = "train" | "val" | "test";

export type ManifestImage = {
  id: string;
  age: number;
  path: string;
  split?: ManifestSplit;
};

export type ManifestDocument = {
  schema_version: string;
  seed?: number;
  images: ManifestImage[];
};

export type UpdatedBy = {
  uid: string;
  email: string | null;
  displayName: string | null;
};

export type LabelDocument = {
  id: string;
  age: number;
  view: ViewType;
  items: Record<ItemKey, 0 | 1>;
  reviewed: boolean;
  updatedAt?: Timestamp;
  updatedBy?: UpdatedBy;
};

export type ExportRow = {
  id: string;
  age: number;
  split?: ManifestSplit;
  view: ViewType;
  items: Record<ItemKey, 0 | 1>;
  reviewed: boolean;
  missing: boolean;
};

type SaveLabelParams = {
  id: string;
  age: number;
  view: ViewType;
  reviewed: boolean;
  items: Record<ItemKey, 0 | 1>;
  updatedBy: UpdatedBy;
};

function isValidViewType(value: unknown): value is ViewType {
  return typeof value === "string" && VIEW_OPTIONS.includes(value as ViewType);
}

function normalizeItems(rawItems: unknown): Record<ItemKey, 0 | 1> {
  const normalized = createEmptyItems();
  const source =
    rawItems !== null && typeof rawItems === "object"
      ? (rawItems as Record<string, unknown>)
      : {};

  for (const item of items) {
    normalized[item.key as ItemKey] = source[item.key] === 1 ? 1 : 0;
  }

  return normalized;
}

function normalizeLabelData(id: string, age: number, raw: DocumentData): LabelDocument {
  const view = isValidViewType(raw.view) ? raw.view : "unknown";
  return {
    id,
    age,
    view,
    reviewed: raw.reviewed === true,
    items: normalizeItems(raw.items),
    updatedAt: raw.updatedAt,
    updatedBy:
      raw.updatedBy !== null && typeof raw.updatedBy === "object"
        ? {
            uid: typeof raw.updatedBy.uid === "string" ? raw.updatedBy.uid : "",
            email:
              typeof raw.updatedBy.email === "string" ? raw.updatedBy.email : null,
            displayName:
              typeof raw.updatedBy.displayName === "string"
                ? raw.updatedBy.displayName
                : null,
          }
        : undefined,
  };
}

export function createDefaultLabel(image: Pick<ManifestImage, "id" | "age">): LabelDocument {
  return {
    id: image.id,
    age: image.age,
    view: "unknown",
    reviewed: false,
    items: createEmptyItems(),
  };
}

export async function getManifest(): Promise<ManifestDocument> {
  const db = getFirestoreDb();
  const manifestRef = doc(db, "manifests", "default");
  const manifestSnap = await getDoc(manifestRef);

  if (!manifestSnap.exists()) {
    throw new Error("manifests/default 문서가 없습니다. 먼저 seed를 실행하세요.");
  }

  const data = manifestSnap.data();
  if (!Array.isArray(data.images)) {
    throw new Error("manifests/default.images 형식이 올바르지 않습니다.");
  }

  const normalizedImages = data.images
    .filter((image: unknown) => image && typeof image === "object")
    .map((image) => {
      const row = image as Record<string, unknown>;
      return {
        id: String(row.id ?? "").padStart(4, "0"),
        age: Number(row.age ?? 0),
        path: String(row.path ?? ""),
        split:
          row.split === "train" || row.split === "val" || row.split === "test"
            ? row.split
            : undefined,
      } satisfies ManifestImage;
    });

  return {
    schema_version: typeof data.schema_version === "string" ? data.schema_version : "dap_male_v1",
    seed: typeof data.seed === "number" ? data.seed : undefined,
    images: normalizedImages,
  };
}

export function subscribeLabel(
  image: Pick<ManifestImage, "id" | "age">,
  onChange: (label: LabelDocument | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const db = getFirestoreDb();
  const labelRef = doc(db, "labels", image.id);

  return onSnapshot(
    labelRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onChange(null);
        return;
      }
      onChange(normalizeLabelData(image.id, image.age, snapshot.data()));
    },
    (err) => onError?.(err),
  );
}

export async function saveLabel(params: SaveLabelParams): Promise<void> {
  const db = getFirestoreDb();
  const labelRef = doc(db, "labels", params.id);
  const payload = {
    id: params.id,
    age: params.age,
    view: params.view,
    reviewed: params.reviewed,
    items: normalizeItems(params.items),
    updatedBy: params.updatedBy,
    updatedAt: serverTimestamp(),
  };

  try {
    await updateDoc(labelRef, payload);
  } catch {
    await setDoc(labelRef, payload, { merge: true });
  }
}

export async function getUserRole(uid: string): Promise<"annotator" | "admin" | null> {
  const db = getFirestoreDb();
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) {
    return null;
  }
  const role = userSnap.data().role;
  if (role === "annotator" || role === "admin") {
    return role;
  }
  return null;
}

export async function buildExportRows(images: ManifestImage[]): Promise<ExportRow[]> {
  const db = getFirestoreDb();
  const labelPromises = images.map(async (image) => {
    const snap = await getDoc(doc(db, "labels", image.id));
    if (!snap.exists()) {
      return {
        id: image.id,
        age: image.age,
        split: image.split,
        view: "unknown",
        reviewed: false,
        items: createEmptyItems(),
        missing: true,
      } satisfies ExportRow;
    }

    const normalized = normalizeLabelData(image.id, image.age, snap.data());
    return {
      id: normalized.id,
      age: image.age,
      split: image.split,
      view: normalized.view,
      reviewed: normalized.reviewed,
      items: normalized.items,
      missing: false,
    } satisfies ExportRow;
  });

  return Promise.all(labelPromises);
}

export function subscribeReviewedMap(
  manifestIds: string[],
  onChange: (reviewedById: Record<string, boolean>) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const db = getFirestoreDb();
  const idSet = new Set(manifestIds);

  return onSnapshot(
    collection(db, "labels"),
    (snapshot) => {
      const reviewedById: Record<string, boolean> = {};

      for (const docSnap of snapshot.docs) {
        if (!idSet.has(docSnap.id)) {
          continue;
        }
        reviewedById[docSnap.id] = docSnap.data().reviewed === true;
      }

      onChange(reviewedById);
    },
    (err) => onError?.(err),
  );
}
