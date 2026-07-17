import type { Metadata } from "next";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { ProfileCompare } from "@/components/profiles/profile-compare";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { copy, localizedPath, type Locale } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import {
  getProfileComparison,
  parseComparisonSelection,
  type ComparisonSelection,
} from "@/lib/profile-comparison";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompareSearchParams = Record<string, string | string[] | undefined>;

function comparisonPath(locale: Locale, selection: ComparisonSelection) {
  const params = new URLSearchParams({ kind: selection.kind });
  if (selection.leftId) params.set("left", String(selection.leftId));
  if (selection.rightId) params.set("right", String(selection.rightId));
  return `${localizedPath("/compare", locale)}?${params.toString()}`;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<CompareSearchParams>;
}): Promise<Metadata> {
  const [params, locale] = await Promise.all([searchParams, getRequestLocale()]);
  const selection = parseComparisonSelection(params);
  const hasSelection = selection.leftId !== null || selection.rightId !== null;
  const path = comparisonPath(locale, selection);
  return buildPageMetadata({
    title: copy[locale].profiles.comparisonTitle,
    description: copy[locale].profiles.comparisonDescription,
    path,
    locale,
    languagePaths: {
      en: comparisonPath("en", selection),
      ar: comparisonPath("ar", selection),
      "x-default": comparisonPath("en", selection),
    },
    robots: hasSelection ? { index: false, follow: true } : undefined,
  });
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<CompareSearchParams>;
}) {
  const [params, locale, games] = await Promise.all([
    searchParams,
    getRequestLocale(),
    listGamesCached(),
  ]);
  const selection = parseComparisonSelection(params);
  const comparison = await getProfileComparison(selection);
  const text = copy[locale].profiles;
  const common = copy[locale].common;
  const gameNames = Object.fromEntries(
    [comparison.left, comparison.right]
      .filter((profile): profile is NonNullable<typeof profile> => profile !== null)
      .flatMap((profile) => profile.game ? [[profile.game, gameTitleForSlug(profile.game, games, locale)]] : []),
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: text.comparisonTitle },
        ]}
      />
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-primary">{text.compare}</p>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{text.comparisonTitle}</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          {text.comparisonDescription}
        </p>
      </section>
      <ProfileCompare
        kind={selection.kind}
        leftId={selection.leftId}
        rightId={selection.rightId}
        left={comparison.left}
        right={comparison.right}
        gameNames={gameNames}
        locale={locale}
      />
    </main>
  );
}
