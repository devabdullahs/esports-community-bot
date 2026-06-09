import {
  copy,
  directionForLocale,
} from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";

export async function SiteFooter() {
  const locale = await getRequestLocale();
  const text = copy[locale].footer;

  return (
    <footer
      lang={locale}
      dir={directionForLocale(locale)}
      className="border-t"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col justify-between gap-3 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:px-8">
        <p>{text.brand}</p>
        <p>{text.note}</p>
      </div>
    </footer>
  );
}
