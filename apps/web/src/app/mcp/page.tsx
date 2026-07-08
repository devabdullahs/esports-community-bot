import { redirect } from "next/navigation";

export const runtime = "nodejs";

export default function LegacyMcpDocsRedirectPage() {
  redirect("/docs/admin-mcp");
}
