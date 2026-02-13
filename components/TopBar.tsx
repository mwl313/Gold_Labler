import { ManifestImage } from "@/lib/firestore";

type TopBarProps = {
  index: number;
  total: number;
  currentImage: ManifestImage | null;
};

export function TopBar({ index, total, currentImage }: TopBarProps) {
  return (
    <header className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-center text-lg font-semibold text-slate-800">
        이미지 번호 ({index}/{total})
      </div>
      <div className="mt-1 text-center text-sm text-slate-600">
        {currentImage ? `id: ${currentImage.id} | age: ${currentImage.age}` : "이미지를 불러오는 중..."}
      </div>
    </header>
  );
}
