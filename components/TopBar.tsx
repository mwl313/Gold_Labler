import { ManifestImage } from "@/lib/firestore";

type TopBarProps = {
  index: number;
  total: number;
  images: ManifestImage[];
  reviewedById: Record<string, boolean>;
  onSelectIndex: (index: number) => void;
  currentImage: ManifestImage | null;
};

export function TopBar({
  index,
  total,
  images,
  reviewedById,
  onSelectIndex,
  currentImage,
}: TopBarProps) {
  return (
    <header className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-center gap-2 text-lg font-semibold text-slate-800">
        <span>이미지 번호 ({index}/{total})</span>
        <select
          aria-label="이미지 이동"
          value={String(index - 1)}
          onChange={(event) => onSelectIndex(Number(event.target.value))}
          className="max-w-[220px] rounded border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-slate-800"
        >
          {images.map((image, idx) => {
            const completed = reviewedById[image.id] === true;
            const orderLabel = String(idx + 1).padStart(3, "0");
            return (
              <option key={image.id} value={String(idx)}>
                {completed ? `${orderLabel} (완료)` : orderLabel}
              </option>
            );
          })}
        </select>
      </div>
      <div className="mt-1 text-center text-sm text-slate-600">
        {currentImage ? `id: ${currentImage.id} | age: ${currentImage.age}` : "이미지를 불러오는 중..."}
      </div>
    </header>
  );
}
