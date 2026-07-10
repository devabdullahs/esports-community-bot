import type { Metadata } from "next";
import { GlobeIcon, ShieldCheckIcon } from "lucide-react";
import { McpPageActions } from "@/components/admin/mcp-page-actions";
import { PostBody } from "@/components/news/post-body";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { directionForLocale, localizedPath, type Locale } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getPublicMcpCopyPage } from "@/lib/public-mcp-copy-page";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COPY = {
  en: {
    title: "Public MCP Server",
    description:
      "Read-only MCP documentation for public Esports Community website data. No key required.",
    badge: "Read-only public data",
    security:
      "This endpoint is read-only and returns public website data intended for visitors.",
  },
  ar: {
    title: "خادم MCP العام",
    description:
      "شرح MCP للقراءة فقط من بيانات موقع Esports Community العامة. لا يحتاج إلى مفتاح.",
    badge: "بيانات عامة للقراءة فقط",
    security:
      "هذه النقطة للقراءة فقط وتعرض بيانات عامة مخصصة لزوار الموقع.",
  },
} satisfies Record<Locale, { title: string; description: string; badge: string; security: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const text = COPY[locale];
  return buildPageMetadata({
    title: text.title,
    description: text.description,
    path: localizedPath("/docs/mcp", locale),
    locale,
  });
}

export default async function PublicMcpDocsPage() {
  const locale = await getRequestLocale();
  const text = COPY[locale];
  const markdown = getPublicMcpCopyPage(locale);
  const docsHref = localizedPath("/docs/mcp", locale);
  const dir = directionForLocale(locale);

  return (
    <main
      dir={dir}
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-7 px-4 py-8 sm:px-8 sm:py-10"
    >
      <section className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-3xl flex-col items-start gap-4">
          <Badge variant="outline">
            <GlobeIcon data-icon="inline-start" />
            {text.badge}
          </Badge>
          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-semibold leading-tight text-balance sm:text-4xl">
              {text.title}
            </h1>
            <p className="text-sm leading-6 text-muted-foreground sm:text-base">
              {text.description}
            </p>
          </div>
        </div>
        <McpPageActions
          markdown={markdown}
          docsHref={docsHref}
          endpointPath="/api/public-mcp"
          assistantKind="public"
          locale={locale}
          showDocsLink={false}
        />
      </section>

      <Card className="border-primary/25 bg-primary/5">
        <CardContent className="flex gap-3 p-4 text-sm leading-6 text-muted-foreground">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>{text.security}</p>
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardContent className="p-5 sm:p-7">
          <PostBody
            markdown={markdown}
            dir={dir}
            className="max-w-none [&_h1]:mt-0 [&_pre]:overflow-x-auto"
          />
        </CardContent>
      </Card>
    </main>
  );
}
