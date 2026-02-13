import { ExportPageClient } from "./pageClient";

function parseAdminEmails(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export default function ExportPage() {
  const adminEmails = parseAdminEmails(process.env.ADMIN_EMAILS);
  return <ExportPageClient adminEmails={adminEmails} />;
}
