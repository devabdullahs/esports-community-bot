import type { Metadata } from "next";
import { KeyRoundIcon, ShieldCheckIcon } from "lucide-react";
import { McpPageActions } from "@/components/admin/mcp-page-actions";
import { PostBody } from "@/components/news/post-body";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getAdminMcpCopyPage } from "@/lib/admin-mcp-copy-page";
import { directionForLocale, localizedPath, type Locale } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COPY = {
  en: {
    title: "Admin MCP Server",
    description:
      "Public setup documentation for the Esports Community admin MCP server. The endpoint still requires approved admin bearer keys.",
    badge: "Admin tools",
    security:
      "This page is public so AI assistants can read the setup guide. It contains setup instructions only; every MCP request still requires a valid scoped bearer key.",
  },
  ar: {
    title: "خادم MCP الإداري",
    description:
      "شرح عام لإعداد خادم MCP الإداري الخاص بموقع Esports Community. نقطة النهاية ما زالت تتطلب مفاتيح Bearer إدارية معتمدة.",
    badge: "أدوات الإدارة",
    security:
      "هذه الصفحة عامة حتى تتمكن أدوات الذكاء الاصطناعي من قراءة شرح الإعداد. تحتوي على تعليمات الإعداد فقط؛ وكل طلب MCP ما زال يتطلب مفتاح Bearer صالحا ومحدد الصلاحيات.",
  },
} satisfies Record<Locale, { title: string; description: string; badge: string; security: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const text = COPY[locale];
  return buildPageMetadata({
    title: text.title,
    description: text.description,
    path: localizedPath("/docs/admin-mcp", locale),
    locale,
  });
}

export default async function PublicAdminMcpDocsPage() {
  const locale = await getRequestLocale();
  const text = COPY[locale];
  const markdown = getAdminMcpCopyPage(locale);
  const docsHref = localizedPath("/docs/admin-mcp", locale);

  return (
    <main
      dir={directionForLocale(locale)}
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-7 px-4 py-8 sm:px-8 sm:py-10"
    >
      <section className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-3xl flex-col items-start gap-4">
          <Badge variant="outline">
            <KeyRoundIcon data-icon="inline-start" />
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
            className="max-w-none [&_h1]:mt-0 [&_pre]:overflow-x-auto"
          />
        </CardContent>
      </Card>
    </main>
  );
}
