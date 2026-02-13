"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { buildExportRows, getManifest, getUserRole } from "@/lib/firestore";

type ExportPageClientProps = {
  adminEmails: string[];
};

function downloadFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ExportPageClient({ adminEmails }: ExportPageClientProps) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [manifestCount, setManifestCount] = useState(0);
  const [missingCount, setMissingCount] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedAdminEmails = useMemo(
    () => new Set(adminEmails.map((email) => email.toLowerCase())),
    [adminEmails],
  );

  useEffect(() => {
    if (loading) {
      return;
    }
    if (!user) {
      router.replace("/login");
      return;
    }

    let cancelled = false;
    const checkRole = async () => {
      setCheckingAdmin(true);
      try {
        const emailAllowed = user.email
          ? normalizedAdminEmails.has(user.email.toLowerCase())
          : false;
        const role = await getUserRole(user.uid);
        const roleAllowed = role === "admin";
        if (!cancelled) {
          setAuthorized(emailAllowed || roleAllowed);
        }
      } catch {
        if (!cancelled) {
          setAuthorized(false);
        }
      } finally {
        if (!cancelled) {
          setCheckingAdmin(false);
        }
      }
    };

    checkRole();
    return () => {
      cancelled = true;
    };
  }, [loading, normalizedAdminEmails, router, user]);

  useEffect(() => {
    if (!authorized) {
      return;
    }
    let cancelled = false;
    const loadManifestCount = async () => {
      try {
        const manifest = await getManifest();
        if (!cancelled) {
          setManifestCount(manifest.images.length);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Manifest를 읽지 못했습니다.";
          setError(message);
        }
      }
    };
    loadManifestCount();
    return () => {
      cancelled = true;
    };
  }, [authorized]);

  const onExport = async () => {
    setProcessing(true);
    setError(null);
    try {
      const manifest = await getManifest();
      const rows = await buildExportRows(manifest.images);
      const missing = rows.filter((row) => row.missing).length;
      setMissingCount(missing);

      downloadFile("gold_labels.json", `${JSON.stringify(rows, null, 2)}\n`);
      downloadFile(
        "gold_labels.jsonl",
        `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Export 파일 생성에 실패했습니다.";
      setError(message);
    } finally {
      setProcessing(false);
    }
  };

  if (loading || checkingAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-slate-600">
        권한 확인 중...
      </main>
    );
  }

  if (!authorized) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          admin 권한이 필요합니다.
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 p-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Admin Export</h1>
        <p className="mt-2 text-sm text-slate-600">
          manifest 기준 {manifestCount}개 이미지를 대상으로 `gold_labels.json`,
          `gold_labels.jsonl`을 생성합니다.
        </p>
        {missingCount !== null && (
          <p className="mt-2 text-sm text-slate-700">누락(labels 없음): {missingCount}개</p>
        )}
        {error && (
          <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        <button
          type="button"
          onClick={onExport}
          disabled={processing}
          className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {processing ? "생성 중..." : "JSON/JSONL 다운로드"}
        </button>
      </div>
    </main>
  );
}
