type NavButtonsProps = {
  onPrev: () => void;
  onNext: () => void;
  prevDisabled: boolean;
  nextDisabled: boolean;
  creditText?: string;
};

const baseButtonClass =
  "rounded-md px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

export function NavButtons({
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
  creditText,
}: NavButtonsProps) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <button
        type="button"
        onClick={onPrev}
        disabled={prevDisabled}
        className={`${baseButtonClass} bg-slate-200 text-slate-900 hover:bg-slate-300`}
      >
        뒤로
      </button>
      <div className="flex items-center">
        {creditText ? (
          <span className="mr-3 px-2 text-xs font-medium text-slate-500">{creditText}</span>
        ) : null}
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled}
          className={`${baseButtonClass} bg-slate-900 text-white hover:bg-slate-700`}
        >
          다음
        </button>
      </div>
    </div>
  );
}
