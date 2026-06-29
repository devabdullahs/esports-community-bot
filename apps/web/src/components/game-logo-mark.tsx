import { Gamepad2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

const GAME_GLYPH_PATHS: Record<string, string> = {
  ageofempires: "/game-glyphs/ageofempires.svg",
  apexlegends: "/game-glyphs/apexlegends.png",
  brawlhalla: "/game-glyphs/brawlhalla.svg",
  brawlstars: "/game-glyphs/brawlstars.svg",
  callofduty: "/game-glyphs/callofduty.png",
  callofdutyleague: "/game-glyphs/callofdutyleague.png",
  chess: "/game-glyphs/chess.svg",
  clashofclans: "/game-glyphs/clashofclans.svg",
  clashroyale: "/game-glyphs/clashroyale.svg",
  counterstrike: "/game-glyphs/counterstrike.svg",
  crossfire: "/game-glyphs/crossfire.svg",
  deadlock: "/game-glyphs/deadlock.svg",
  deltaforce: "/game-glyphs/deltaforce.svg",
  dota2: "/game-glyphs/dota2.png",
  easportsfc: "/game-glyphs/esportsfc.png",
  esports: "/game-glyphs/esports.svg",
  esportsfc: "/game-glyphs/esportsfc.png",
  fifa: "/game-glyphs/esportsfc.png",
  fighters: "/game-glyphs/fighters.png",
  fortnite: "/game-glyphs/fortnite.png",
  freefire: "/game-glyphs/freefire.png",
  halo: "/game-glyphs/halo.svg",
  hearthstone: "/game-glyphs/hearthstone.svg",
  heroes: "/game-glyphs/heroes.svg",
  honorofkings: "/game-glyphs/honorofkings.svg",
  leagueoflegends: "/game-glyphs/leagueoflegends.png",
  marvelrivals: "/game-glyphs/marvelrivals.svg",
  mobilelegends: "/game-glyphs/mobilelegends.png",
  naraka: "/game-glyphs/naraka.svg",
  osu: "/game-glyphs/osu.svg",
  overwatch: "/game-glyphs/overwatch.png",
  pubg: "/game-glyphs/pubg.png",
  pubgmobile: "/game-glyphs/pubgmobile.svg",
  rainbowsix: "/game-glyphs/rainbowsix.png",
  rocketleague: "/game-glyphs/rocketleague.svg",
  simracing: "/game-glyphs/simracing.svg",
  smash: "/game-glyphs/smash.svg",
  splatoon: "/game-glyphs/splatoon.svg",
  starcraft2: "/game-glyphs/starcraft2.svg",
  stormgate: "/game-glyphs/stormgate.svg",
  teamfighttactics: "/game-glyphs/tft.png",
  teamfortress: "/game-glyphs/teamfortress.svg",
  thefinals: "/game-glyphs/thefinals.svg",
  tft: "/game-glyphs/tft.png",
  trackmania: "/game-glyphs/trackmania.svg",
  valorant: "/game-glyphs/valorant.png",
  warcraft: "/game-glyphs/warcraft.svg",
  warthunder: "/game-glyphs/warthunder.svg",
  warzone: "/game-glyphs/warzone.png",
  wildrift: "/game-glyphs/wildrift.svg",
  worldoftanks: "/game-glyphs/worldoftanks.svg",
};

const GAME_SLUG_ALIASES: Record<string, string> = {
  "cs2": "counterstrike",
  "csgo": "counterstrike",
  "callofdutyleague": "callofdutyleague",
  "fifa": "esportsfc",
  "fightinggames": "fighters",
  "teamfighttactics": "tft",
};

export function normalizeGameLogoSlug(slug: string | null | undefined): string {
  const key = String(slug ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return GAME_SLUG_ALIASES[key] ?? key;
}

export function gameLogoPath(slug: string | null | undefined): string | null {
  const key = normalizeGameLogoSlug(slug);
  return GAME_GLYPH_PATHS[key] ?? null;
}

type GameLogoMarkProps = {
  slug: string | null | undefined;
  label?: string;
  className?: string;
  iconClassName?: string;
};

export function GameLogoMark({
  slug,
  label,
  className,
  iconClassName,
}: GameLogoMarkProps) {
  const path = gameLogoPath(slug);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-2xl border border-border/80 bg-card/80 text-primary shadow-sm shadow-black/20",
        className,
      )}
      aria-label={label}
    >
      {path ? (
        <span
          aria-hidden="true"
          className={cn("block bg-current", iconClassName)}
          style={{
            WebkitMask: `url("${path}") center / contain no-repeat`,
            mask: `url("${path}") center / contain no-repeat`,
          }}
        />
      ) : (
        <Gamepad2Icon aria-hidden="true" className={cn("size-5", iconClassName)} />
      )}
    </span>
  );
}
