import Link from "next/link";

export default function Home() {
  return (
    <main className="flex h-[100dvh] flex-col items-center justify-center gap-6 bg-slate-50">
      <h1 className="text-xl font-semibold text-slate-900">DAP 검수</h1>
      <nav className="flex flex-col gap-3">
        <Link
          href="/review"
          className="rounded-md bg-slate-900 px-6 py-3 text-center text-sm font-semibold text-white hover:bg-slate-700"
        >
          /review 검수 시작
        </Link>
        <Link
          href="/label"
          className="rounded-md border border-slate-300 bg-white px-6 py-3 text-center text-sm font-semibold text-slate-900 hover:bg-slate-100"
        >
          라벨링 페이지로 이동
        </Link>
      </nav>
    </main>
  );
}
