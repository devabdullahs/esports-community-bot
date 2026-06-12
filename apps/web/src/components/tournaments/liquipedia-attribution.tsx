import { copy, type Locale } from "@/lib/i18n";

// Legal requirement (operator decision): every tournaments/matches surface must
// carry visible Liquipedia attribution with links to the site and the license.
// Wording mirrors the bot embed footer ("Data from Liquipedia — CC-BY-SA 3.0",
// src/lib/matchMessage.js).
export function LiquipediaAttribution({ locale }: { locale: Locale }) {
  const text = copy[locale].tournaments;
  return (
    <p
      data-testid="liquipedia-attribution"
      className="border-t pt-6 text-xs leading-5 text-muted-foreground"
    >
      {text.attribution}
      {" — "}
      <a
        href="https://liquipedia.net"
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="underline underline-offset-2 hover:text-foreground"
      >
        {text.attributionView}
      </a>
      {" · "}
      <a
        href="https://creativecommons.org/licenses/by-sa/3.0/"
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="underline underline-offset-2 hover:text-foreground"
      >
        {text.attributionLicense}
      </a>
    </p>
  );
}
