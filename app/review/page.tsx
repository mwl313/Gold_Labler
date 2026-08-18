"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { items } from "@/data/items";
import { ImageViewer } from "@/components/ImageViewer";

type ReviewQueueItem = {
  id: string;
  age: number;
  image: string;
  items: Record<string, 0 | 1>;
  confidence: Record<string, number>;
  disagree_count: number;
  pred_total_score: number;
  priority: number;
};

type ReviewStateEntry = {
  final_items: Record<string, 0 | 1>;
  touched: string[];
  reviewed_at: string;
  note: string;
};

type ReviewState = Record<string, ReviewStateEntry>;

const STORAGE_KEY = "dap_review_state_v1";

const PRIORITY_LABELS: Record<number, string> = {
  1: "전장검수",
  2: "항목필터",
  3: "자동확정",
};

const PRIORITY_BADGE_CLASSES: Record<number, string> = {
  1: "bg-red-100 text-red-700",
  2: "bg-amber-100 text-amber-700",
  3: "bg-emerald-100 text-emerald-700",
};

export default function ReviewPage() {
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<ReviewState>({});
  const [stateLoaded, setStateLoaded] = useState(false);
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(true);
  const [showReviewedList, setShowReviewedList] = useState(false);
  const didInitialPositionRef = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setState(JSON.parse(raw) as ReviewState);
      }
    } catch {
      // 손상된 상태는 무시하고 새로 시작한다.
    } finally {
      setStateLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!stateLoaded) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // localStorage 용량 초과 등은 무시한다.
    }
  }, [state, stateLoaded]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoadError(null);
      try {
        const response = await fetch("/data/review_queue.json");
        if (!response.ok) {
          throw new Error(`review_queue.json 로드 실패 (HTTP ${response.status})`);
        }
        const data = (await response.json()) as unknown;
        if (!Array.isArray(data)) {
          throw new Error("review_queue.json 응답이 배열이 아닙니다");
        }
        const queueData = data as ReviewQueueItem[];
        if (!cancelled) {
          setQueue(queueData);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "알 수 없는 오류");
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!stateLoaded || queue.length === 0 || didInitialPositionRef.current) {
      return;
    }
    didInitialPositionRef.current = true;
    if (onlyUnreviewed) {
      const idx = queue.findIndex((q) => !state[q.id]?.reviewed_at);
      setIndex(idx !== -1 ? idx : 0);
    } else {
      setIndex(0);
    }
  }, [stateLoaded, queue, onlyUnreviewed, state]);

  const isReviewed = useCallback(
    (id: string) => Boolean(state[id]?.reviewed_at),
    [state],
  );

  const current = queue[index] ?? null;

  const reviewedIds = useMemo(
    () => queue.filter((q) => isReviewed(q.id)),
    [queue, isReviewed],
  );

  const allReviewed = useMemo(
    () => queue.length > 0 && queue.every((q) => isReviewed(q.id)),
    [queue, isReviewed],
  );

  const remaining = useMemo(
    () => queue.filter((q) => !isReviewed(q.id)).length,
    [queue, isReviewed],
  );

  const entry = current ? state[current.id] : undefined;

  const values = useMemo(
    () => entry?.final_items ?? current?.items ?? {},
    [entry, current],
  );
  const touched = entry?.touched ?? [];

  const passCount = useMemo(
    () => Object.values(values).reduce<number>((acc, value) => acc + value, 0),
    [values],
  );

  const toggleItem = (key: string, checked: boolean) => {
    if (!current) {
      return;
    }
    setState((prev) => {
      const prevEntry = prev[current.id];
      const final_items: Record<string, 0 | 1> = {
        ...(prevEntry?.final_items ?? current.items),
        [key]: checked ? 1 : 0,
      };
      const prevTouched = prevEntry?.touched ?? [];
      const nextTouched = prevTouched.includes(key)
        ? prevTouched
        : [...prevTouched, key];
      return {
        ...prev,
        [current.id]: {
          final_items,
          touched: nextTouched,
          reviewed_at: prevEntry?.reviewed_at ?? "",
          note: prevEntry?.note ?? "",
        },
      };
    });
  };

  const updateNote = (text: string) => {
    if (!current) {
      return;
    }
    setState((prev) => {
      const prevEntry = prev[current.id];
      return {
        ...prev,
        [current.id]: {
          final_items: prevEntry?.final_items ?? current.items,
          touched: prevEntry?.touched ?? [],
          reviewed_at: prevEntry?.reviewed_at ?? "",
          note: text,
        },
      };
    });
  };

  const completeCurrent = () => {
    if (!current) {
      return;
    }
    const now = new Date().toISOString();
    setState((prev) => {
      const prevEntry = prev[current.id];
      return {
        ...prev,
        [current.id]: {
          final_items: prevEntry?.final_items ?? current.items,
          touched: prevEntry?.touched ?? [],
          reviewed_at: prevEntry?.reviewed_at ?? now,
          note: prevEntry?.note ?? "",
        },
      };
    });
    if (onlyUnreviewed) {
      const nextIdx = queue.findIndex((q, i) => i > index && !state[q.id]?.reviewed_at);
      if (nextIdx !== -1) {
        setIndex(nextIdx);
      }
    } else {
      setIndex((i) => Math.min(i + 1, queue.length - 1));
    }
  };

  const goNext = () => {
    if (queue.length === 0) {
      return;
    }
    if (onlyUnreviewed) {
      const nextIdx = queue.findIndex((q, i) => i > index && !isReviewed(q.id));
      if (nextIdx !== -1) {
        setIndex(nextIdx);
      }
    } else {
      setIndex((i) => Math.min(i + 1, queue.length - 1));
    }
  };

  const goPrev = () => {
    if (queue.length === 0) {
      return;
    }
    if (onlyUnreviewed) {
      for (let i = index - 1; i >= 0; i -= 1) {
        if (!isReviewed(queue[i].id)) {
          setIndex(i);
          return;
        }
      }
    } else {
      setIndex((i) => Math.max(i - 1, 0));
    }
  };

  const toggleUnreviewedFilter = () => {
    const next = !onlyUnreviewed;
    setOnlyUnreviewed(next);
    if (next && isReviewed(queue[index]?.id ?? "")) {
      const idx = queue.findIndex((q, i) => i > index && !isReviewed(q.id));
      setIndex(idx !== -1 ? idx : 0);
    }
  };

  const resetState = () => {
    if (!window.confirm("검수 상태를 모두 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) {
      return;
    }
    setState({});
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 무시
    }
    setIndex(0);
    setShowReviewedList(false);
  };

  const exportJsonl = () => {
    const reviewed = queue.filter((q) => isReviewed(q.id));
    if (reviewed.length === 0) {
      window.alert("검수 완료된 그림이 없습니다.");
      return;
    }
    const lines = reviewed.map((q) => {
      const e = state[q.id];
      return JSON.stringify({
        id: q.id,
        age: q.age,
        items: e.final_items,
        ai_items: q.items,
        touched: e.touched,
        reviewed_at: e.reviewed_at,
      });
    });
    const blob = new Blob([lines.join("\n")], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `reviewed_labels_${timestamp}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loadError) {
    return (
      <main className="flex h-[100dvh] items-center justify-center p-4">
        <div className="max-w-2xl rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-semibold">검수 큐를 불러오지 못했습니다.</div>
          <div className="mt-1">{loadError}</div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 rounded bg-red-200 px-3 py-1.5 text-sm font-semibold text-red-900 hover:bg-red-300"
          >
            다시 시도
          </button>
        </div>
      </main>
    );
  }

  if (!current) {
    return (
      <main className="flex h-[100dvh] flex-col items-center justify-center gap-4 text-sm text-slate-600">
        <div>{queue.length === 0 ? "검수 큐를 불러오는 중..." : "표시할 그림이 없습니다."}</div>
        {queue.length > 0 ? (
          <button
            type="button"
            onClick={() => setOnlyUnreviewed(false)}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            검수 완료 목록 보기
          </button>
        ) : null}
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-[1600px] flex-col gap-3 overflow-hidden p-3 lg:gap-4 lg:p-4">
      <header className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm">
            <span className="font-semibold">
              {index + 1} / {queue.length}
            </span>
            <span className="text-slate-600">
              {" "}
              · priority {current.priority} ({PRIORITY_LABELS[current.priority]})
            </span>
            <span className="ml-3 text-slate-600">남은 미검수 {remaining}</span>
            {allReviewed && onlyUnreviewed ? (
              <span className="ml-3 font-semibold text-emerald-600">모든 그림을 검수했습니다</span>
            ) : null}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={onlyUnreviewed}
                onChange={() => toggleUnreviewedFilter()}
                className="h-4 w-4 accent-slate-900"
              />
              미검수만 보기
            </label>
            <button
              type="button"
              onClick={() => setShowReviewedList((prev) => !prev)}
              className="rounded bg-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-300"
            >
              검수 완료 {reviewedIds.length}장 {showReviewedList ? "닫기" : "보기"}
            </button>
            <button
              type="button"
              onClick={goPrev}
              disabled={index === 0}
              className="rounded bg-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              이전
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={index === queue.length - 1}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              다음
            </button>
            <button
              type="button"
              onClick={resetState}
              className="rounded border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              초기화
            </button>
            <button
              type="button"
              onClick={exportJsonl}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Export JSONL
            </button>
          </div>
        </div>

        {showReviewedList ? (
          <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto border-t border-slate-200 pt-2">
            {reviewedIds.length === 0 ? (
              <span className="text-sm text-slate-500">아직 검수 완료된 그림이 없습니다.</span>
            ) : (
              reviewedIds.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => {
                    const idx = queue.findIndex((x) => x.id === q.id);
                    if (idx !== -1) {
                      setIndex(idx);
                      setShowReviewedList(false);
                    }
                  }}
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    q.id === current.id
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {q.id}
                </button>
              ))
            )}
          </div>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(320px,38vw)] lg:gap-4">
        <ImageViewer src={current.image} alt={`DAP ${current.id}`} />

        <section className="flex min-h-0 flex-col gap-2 overflow-hidden lg:gap-3">
          <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            <span className="text-base font-semibold text-slate-900">id {current.id}</span>
            <span className="text-slate-600">age {current.age}</span>
            <span className="text-slate-600">AI 총점 {current.pred_total_score}</span>
            <span className="text-slate-600">이견 {current.disagree_count}항</span>
            <span
              className={`rounded px-2 py-0.5 text-xs font-semibold ${
                PRIORITY_BADGE_CLASSES[current.priority]
              }`}
            >
              priority {current.priority} · {PRIORITY_LABELS[current.priority]}
            </span>
            {isReviewed(current.id) ? (
              <span className="font-semibold text-emerald-600">검수 완료</span>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="shrink-0 border-b border-slate-200 px-4 py-3">
              <div className="text-base font-semibold text-slate-900">통과 개수 {passCount}/60</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {items.map((item) => {
                const value = values[item.key] ?? 0;
                const conf = current.confidence[item.key] ?? 1;
                const disagree = conf < 1.0;
                const isTouched = touched.includes(item.key);
                const rowClass = [
                  "flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm",
                  isTouched
                    ? "bg-blue-50 hover:bg-blue-100"
                    : disagree
                      ? "bg-yellow-50 hover:bg-yellow-100"
                      : "hover:bg-slate-100",
                ].join(" ");
                return (
                  <label key={item.key} className={rowClass}>
                    <input
                      type="checkbox"
                      checked={value === 1}
                      onChange={(event) => toggleItem(item.key, event.target.checked)}
                      className={`h-4 w-4 ${isTouched ? "accent-blue-600" : "accent-slate-900"}`}
                    />
                    <span className="flex-1">{item.label}</span>
                    <span className="text-xs text-slate-400">
                      {current.items[item.key] === 1 ? "AI ✓" : "AI ✗"}
                    </span>
                    {disagree ? (
                      <span className="rounded bg-yellow-200 px-1.5 py-0.5 text-[11px] font-semibold text-yellow-800">
                        conf {conf.toFixed(2)}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <input
              type="text"
              value={entry?.note ?? ""}
              onChange={(event) => updateNote(event.target.value)}
              placeholder="메모 (선택)"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={completeCurrent}
              className="mt-2 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              검수 완료
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
