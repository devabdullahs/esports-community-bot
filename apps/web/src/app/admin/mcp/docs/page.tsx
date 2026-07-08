import { redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { McpPageActions } from "@/components/admin/mcp-page-actions";
import { PostBody } from "@/components/news/post-body";
import { Card, CardContent } from "@/components/ui/card";
import { getAdminAccess } from "@/lib/admin";
import { ADMIN_MCP_COPY_PAGE } from "@/lib/admin-mcp-copy-page";
import { getAdminCopy } from "@/lib/admin-copy";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminMcpDocsPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/mcp/docs");
  if (!access.isSuper) redirect("/admin");

  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);

  return (
    <AdminPageShell
      backHref="/admin/mcp"
      backLabel={locale === "ar" ? "العودة إلى مفاتيح MCP" : "Back to MCP keys"}
      eyebrow={t.common.superAdmin}
      title={locale === "ar" ? "دليل MCP الإداري" : "Admin MCP docs"}
      description={
        locale === "ar"
          ? "إعداد الخادم، نسخ الرابط، وربط مفاتيح MCP مع أدوات الذكاء الاصطناعي الإدارية."
          : "Setup notes, endpoint details, and client snippets for admin MCP access."
      }
      maxWidth="5xl"
      actions={<McpPageActions markdown={ADMIN_MCP_COPY_PAGE} showDocsLink={false} />}
    >
      <Card className="py-0">
        <CardContent className="p-5 sm:p-7">
          <PostBody
            markdown={ADMIN_MCP_COPY_PAGE}
            className="max-w-none [&_h1]:mt-0 [&_pre]:overflow-x-auto"
          />
        </CardContent>
      </Card>
    </AdminPageShell>
  );
}
