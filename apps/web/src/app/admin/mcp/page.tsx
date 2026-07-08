import { redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { McpKeyManager } from "@/components/admin/mcp-key-manager";
import { McpPageActions } from "@/components/admin/mcp-page-actions";
import { getAdminAccess } from "@/lib/admin";
import { ADMIN_MCP_COPY_PAGE } from "@/lib/admin-mcp-copy-page";
import { getAdminCopy } from "@/lib/admin-copy";
import { localizeText } from "@/lib/community-content";
import { listGames } from "@/lib/games";
import { getRequestLocale } from "@/lib/request-locale";
import { listMediaChannels } from "@/lib/media";
import { MCP_TOOL_NAMES, listMcpKeys } from "@/lib/mcp-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminMcpPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/mcp");
  if (!access.isSuper) redirect("/admin");

  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);
  const [keys, games, media] = await Promise.all([
    listMcpKeys(),
    listGames(),
    listMediaChannels(),
  ]);

  return (
    <AdminPageShell
      backHref="/admin"
      backLabel={t.common.backToAdmin}
      eyebrow={t.common.superAdmin}
      title={locale === "ar" ? "مفاتيح MCP" : "MCP keys"}
      description={
        locale === "ar"
          ? "أنشئ مفاتيح Bearer آمنة لأدوات الذكاء الاصطناعي الإدارية، وتابعها أو ألغها من مكان واحد."
          : "Create, monitor, and revoke secure bearer keys for admin AI tools."
      }
      maxWidth="5xl"
      actions={<McpPageActions markdown={ADMIN_MCP_COPY_PAGE} />}
    >
      <McpKeyManager
        keys={keys}
        tools={MCP_TOOL_NAMES}
        games={games.map((game) => ({ slug: game.slug, label: localizeText(game.title, locale) }))}
        media={media.map((channel) => ({ slug: channel.slug, label: localizeText(channel.name, locale) }))}
        locale={locale}
        defaultOwnerDiscordId={access.discordUserId ?? ""}
        defaultOwnerName={access.displayName ?? ""}
      />
    </AdminPageShell>
  );
}
