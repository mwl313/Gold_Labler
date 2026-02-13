import { ItemDefinition } from "@/data/items";

type ItemChecklistProps = {
  itemDefs: ItemDefinition[];
  values: Record<string, 0 | 1>;
  passCount: number;
  reviewed: boolean;
  view: string;
  onToggle: (key: string, checked: boolean) => void;
  onReviewChange: (checked: boolean) => void;
  onViewChange: (view: "front" | "profile" | "mixed" | "unknown") => void;
};

const VIEW_LABELS: Record<"front" | "profile" | "mixed" | "unknown", string> = {
  front: "정면",
  profile: "측면",
  mixed: "혼합",
  unknown: "미분류",
};

export function ItemChecklist({
  itemDefs,
  values,
  passCount,
  reviewed,
  view,
  onToggle,
  onReviewChange,
  onViewChange,
}: ItemChecklistProps) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="text-base font-semibold text-slate-900">통과 개수 {passCount}/60</div>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <label htmlFor="view" className="font-medium text-slate-700">
            View
          </label>
          <select
            id="view"
            value={view}
            onChange={(event) =>
              onViewChange(event.target.value as "front" | "profile" | "mixed" | "unknown")
            }
            className="rounded border border-slate-300 bg-white px-2 py-1"
          >
            {(Object.keys(VIEW_LABELS) as Array<keyof typeof VIEW_LABELS>).map((option) => (
              <option key={option} value={option}>
                {VIEW_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(event) => onReviewChange(event.target.checked)}
            className="h-4 w-4 accent-slate-900"
          />
          채점 완료(reviewed)
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {itemDefs.map((item) => (
          <label
            key={item.key}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-100"
          >
            <input
              type="checkbox"
              checked={values[item.key] === 1}
              onChange={(event) => onToggle(item.key, event.target.checked)}
              className="h-4 w-4 accent-slate-900"
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
