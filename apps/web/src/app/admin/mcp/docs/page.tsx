import { redirect } from "next/navigation";

export const runtime = "nodejs";

export default function AdminMcpDocsRedirectPage() {
  redirect("/docs/admin-mcp");
}
