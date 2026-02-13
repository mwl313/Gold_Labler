"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, signInWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      router.replace("/label");
    }
  }, [loading, router, user]);

  const onSignIn = async () => {
    setPending(true);
    setError(null);
    try {
      await signInWithGoogle();
      router.replace("/label");
    } catch (err) {
      const message = err instanceof Error ? err.message : "로그인에 실패했습니다.";
      setError(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">DAP Gold Labeler</h1>
        <p className="mt-2 text-sm text-slate-600">
          Google 계정으로 로그인 후 라벨링을 시작하세요.
        </p>
        {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <button
          type="button"
          disabled={loading || pending}
          onClick={onSignIn}
          className="mt-5 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "로그인 중..." : "Google 로그인"}
        </button>
      </div>
    </main>
  );
}
