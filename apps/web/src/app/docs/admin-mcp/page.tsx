import type { Metadata } from "next";
import { KeyRoundIcon, ShieldCheckIcon } from "lucide-react";
import { McpPageActions } from "@/components/admin/mcp-page-actions";
import { PostBody } from "@/components/news/post-body";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ADMIN_MCP_COPY_PAGE } from "@/lib/admin-mcp-copy-page";
import { buildPageMetadata } from "@/lib/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TITLE = "Admin MCP Server";
const DESCRIPTION =
  "Public setup documentation for the Esports Community admin MCP server. The endpoint still requires approved admin bearer keys.";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: "/docs/admin-mcp",
  });
}

export default function PublicAdminMcpDocsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-7 px-4 py-8 sm:px-8 sm:py-10">
      <section className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-3xl flex-col items-start gap-4">
          <Badge variant="outline">
            <KeyRoundIcon data-icon="inline-start" />
            Admin tools
          </Badge>
          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-semibold leading-tight text-balance sm:text-4xl">
              {TITLE}
            </h1>
            <p className="text-sm leading-6 text-muted-foreground sm:text-base">
              {DESCRIPTION}
            </p>
          </div>
        </div>
        <McpPageActions markdown={ADMIN_MCP_COPY_PAGE} showDocsLink={false} />
      </section>

      <Card className="border-primary/25 bg-primary/5">
        <CardContent className="flex gap-3 p-4 text-sm leading-6 text-muted-foreground">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            This page is public so AI assistants can read the setup guide. It does not expose MCP
            keys, sessions, admin data, or dashboard-only actions. Every MCP request still requires
            a valid scoped bearer key.
          </p>
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardContent className="p-5 sm:p-7">
          <PostBody
            markdown={ADMIN_MCP_COPY_PAGE}
            className="max-w-none [&_h1]:mt-0 [&_pre]:overflow-x-auto"
          />
        </CardContent>
      </Card>
    </main>
  );
}
