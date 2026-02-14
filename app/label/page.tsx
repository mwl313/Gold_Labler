"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Timestamp } from "firebase/firestore";
import { items } from "@/data/items";
import { useAuth } from "@/components/AuthProvider";
import { ImageViewer } from "@/components/ImageViewer";
import { ItemChecklist } from "@/components/ItemChecklist";
import { NavButtons } from "@/components/NavButtons";
import { TopBar } from "@/components/TopBar";
import {
  LabelDocument,
  ManifestImage,
  createDefaultLabel,
  getManifest,
  saveLabel,
  subscribeReviewedMap,
  subscribeLabel,
} from "@/lib/firestore";

type SaveState = "idle" | "saving" | "saved" | "error";

function formatUpdatedAt(timestamp?: Timestamp): string {
  if (!timestamp) {
    return "-";
  }
  return timestamp.toDate().toLocaleString("ko-KR");
}

export default function LabelPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [manifest, setManifest] = useState<ManifestImage[]>([]);
  const [manifestLoading, setManifestLoading] = useState(true);
  const [manifestError, setManifestError] = useState<string | null>(null);

  const [index, setIndex] = useState(0);
  const [label, setLabel] = useState<LabelDocument | null>(null);
  const [reviewedById, setReviewedById] = useState<Record<string, boolean>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;

    const load = async () => {
      setManifestLoading(true);
      setManifestError(null);
      try {
        const manifestDoc = await getManifest();
        if (!cancelled) {
          setManifest(manifestDoc.images);
          setIndex(0);
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : "Manifest를 읽지 못했습니다.";
          setManifestError(message);
        }
      } finally {
        if (!cancelled) {
          setManifestLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const currentImage = manifest[index] ?? null;

  useEffect(() => {
    if (!user || manifest.length === 0) {
      setReviewedById({});
      return;
    }

    const unsubscribe = subscribeReviewedMap(
      manifest.map((image) => image.id),
      setReviewedById,
    );

    return () => {
      unsubscribe();
    };
  }, [manifest, user]);

  useEffect(() => {
    if (!currentImage) {
      return;
    }

    setLabel(createDefaultLabel(currentImage));
    setSaveState("idle");

    const unsubscribe = subscribeLabel(
      currentImage,
      (snapshotLabel) => {
        if (snapshotLabel) {
          setLabel(snapshotLabel);
          setSaveState("saved");
        } else {
          setLabel(createDefaultLabel(currentImage));
        }
      },
      () => {
        setSaveState("error");
      },
    );

    return () => {
      unsubscribe();
    };
  }, [currentImage]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!currentImage || !label) {
      return;
    }

    setReviewedById((prev) => {
      if (prev[currentImage.id] === label.reviewed) {
        return prev;
      }
      return {
        ...prev,
        [currentImage.id]: label.reviewed,
      };
    });
  }, [currentImage, label]);

  const queueSave = useCallback(
    (nextLabel: LabelDocument) => {
      if (!user || !currentImage) {
        return;
      }

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      setSaveState("saving");
      saveTimerRef.current = setTimeout(async () => {
        try {
          await saveLabel({
            id: nextLabel.id,
            age: nextLabel.age,
            view: nextLabel.view,
            reviewed: nextLabel.reviewed,
            items: nextLabel.items,
            updatedBy: {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
            },
          });
          setSaveState("saved");
        } catch {
          setSaveState("error");
        }
      }, 200);
    },
    [currentImage, user],
  );

  const passCount = useMemo(
    () =>
      label
        ? Object.values(label.items).reduce<number>((acc, value) => acc + value, 0)
        : 0,
    [label],
  );

  const onToggle = (key: string, checked: boolean) => {
    setLabel((prev) => {
      if (!prev) {
        return prev;
      }
      const next: LabelDocument = {
        ...prev,
        items: {
          ...prev.items,
          [key]: checked ? 1 : 0,
        },
      };
      queueSave(next);
      return next;
    });
  };

  const onReviewChange = (checked: boolean) => {
    setLabel((prev) => {
      if (!prev) {
        return prev;
      }
      const next = { ...prev, reviewed: checked };
      queueSave(next);
      return next;
    });
  };

  const onViewChange = (view: "front" | "profile" | "mixed" | "unknown") => {
    setLabel((prev) => {
      if (!prev) {
        return prev;
      }
      const next = { ...prev, view };
      queueSave(next);
      return next;
    });
  };

  if (loading || manifestLoading) {
    return (
      <main className="flex h-[100dvh] items-center justify-center text-sm text-slate-600">
        로딩 중...
      </main>
    );
  }

  if (!user) {
    return null;
  }

  if (manifestError) {
    return (
      <main className="flex h-[100dvh] items-center justify-center p-4">
        <div className="max-w-2xl rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {manifestError}
        </div>
      </main>
    );
  }

  if (!currentImage || !label) {
    return (
      <main className="flex h-[100dvh] items-center justify-center text-sm text-slate-600">
        Manifest 이미지가 비어 있습니다.
      </main>
    );
  }

  return (
    <main className="relative mx-auto flex h-[100dvh] w-full max-w-[1600px] flex-col gap-3 overflow-hidden p-3 lg:gap-4 lg:p-4">
      <TopBar
        index={index + 1}
        total={manifest.length}
        images={manifest}
        reviewedById={reviewedById}
        onSelectIndex={setIndex}
        currentImage={currentImage}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(320px,38vw)] lg:gap-4">
        <ImageViewer src={currentImage.path} alt={`DAP ${currentImage.id}`} />

        <section className="flex min-h-0 flex-col gap-2 overflow-hidden lg:gap-3">
          <div className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            <div className="font-semibold">
              저장 상태:{" "}
              {saveState === "saving"
                ? "저장중"
                : saveState === "saved"
                  ? "저장됨"
                  : saveState === "error"
                    ? "실패"
                    : "대기"}
            </div>
            <div className="mt-1 text-slate-600">
              마지막 수정자: {label.updatedBy?.displayName || label.updatedBy?.email || "-"}
            </div>
            <div className="text-slate-600">마지막 수정시간: {formatUpdatedAt(label.updatedAt)}</div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            <ItemChecklist
              itemDefs={items}
              values={label.items}
              passCount={passCount}
              reviewed={label.reviewed}
              view={label.view}
              onToggle={onToggle}
              onReviewChange={onReviewChange}
              onViewChange={onViewChange}
            />
          </div>
        </section>
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(320px,38vw)]">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          {user.displayName || user.email}
          <button
            type="button"
            onClick={() => signOut()}
            className="ml-3 rounded bg-slate-200 px-2 py-1 text-xs text-slate-900 hover:bg-slate-300"
          >
            로그아웃
          </button>
        </div>
        <NavButtons
          onPrev={() => setIndex((prev) => Math.max(0, prev - 1))}
          onNext={() => setIndex((prev) => Math.min(manifest.length - 1, prev + 1))}
          prevDisabled={index === 0}
          nextDisabled={index === manifest.length - 1}
        />
      </div>

      <div className="pointer-events-none absolute right-4 bottom-3 text-[11px] font-medium text-slate-500/90">
        Made by Min.W.Lim
      </div>
    </main>
  );
}
