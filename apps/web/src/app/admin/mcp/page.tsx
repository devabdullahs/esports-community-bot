import { redirect } from "next/navigation";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { McpKeyManager } from "@/components/admin/mcp-key-manager";
import { McpPageActions } from "@/components/admin/mcp-page-actions";
import { getAdminAccess } from "@/lib/admin";
import { getAdminCopy } from "@/lib/admin-copy";
import { localizeText } from "@/lib/community-content";
import { listGames } from "@/lib/games";
import { localizedPath } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import { listMediaChannels } from "@/lib/media";
import { MCP_TOOL_NAMES, listMcpKeys } from "@/lib/mcp-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminMcpPage() {
  const access = await getAdminAccess();
  if (!access.session) redirect("/login?callbackURL=/admin/mcp");
  if (!access.allowed) redirect("/admin");

  const locale = await getRequestLocale();
  const t = getAdminCopy(locale);
  const [allKeys, games, media] = await Promise.all([
    listMcpKeys(),
    listGames(),
    listMediaChannels(),
  ]);
  const keys = access.isSuper
    ? allKeys
    : allKeys.filter((key) => key.ownerDiscordId === access.discordUserId);
  const allowedGameSlugs = access.games === "ALL" ? null : new Set(access.games);
  const allowedMediaSlugs = access.media === "ALL" ? null : new Set(access.media);
  const visibleGames = allowedGameSlugs
    ? games.filter((game) => allowedGameSlugs.has(game.slug))
    : games;
  const visibleMedia = allowedMediaSlugs
    ? media.filter((channel) => allowedMediaSlugs.has(channel.slug))
    : media;

  return (
    <AdminPageShell
      backHref="/admin"
      backLabel={t.common.backToAdmin}
      eyebrow={access.isSuper ? t.common.superAdmin : t.dashboard.roleScoped}
      title={locale === "ar" ? "مفاتيح MCP" : "MCP keys"}
      description={
        access.isSuper
          ? locale === "ar"
            ? "أنشئ مفاتيح Bearer آمنة لأدوات الذكاء الاصطناعي الإدارية، وتابعها أو ألغها من مكان واحد."
            : "Create, monitor, and revoke secure bearer keys for admin AI tools."
          : locale === "ar"
            ? "أنشئ مفاتيح MCP خاصة بحسابك فقط. ترث المفاتيح نفس صلاحيات الألعاب والمنصات الإعلامية المسموحة لك."
            : "Create MCP keys for your own account only. Keys inherit your existing game and media permissions."
      }
      maxWidth="5xl"
      actions={
        <McpPageActions
          variant="keys"
          locale={locale}
          docsHref={localizedPath("/docs/admin-mcp", locale)}
        />
      }
    >
      <McpKeyManager
        keys={keys}
        tools={MCP_TOOL_NAMES}
        games={visibleGames.map((game) => ({ slug: game.slug, label: localizeText(game.title, locale) }))}
        media={visibleMedia.map((channel) => ({ slug: channel.slug, label: localizeText(channel.name, locale) }))}
        locale={locale}
        isSuper={access.isSuper}
        defaultOwnerDiscordId={access.discordUserId ?? ""}
        defaultOwnerName={access.displayName ?? ""}
      />
    </AdminPageShell>
  );
}
