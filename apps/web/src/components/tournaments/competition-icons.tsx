import Image from "next/image";

type GameIconSize = "inline" | "mark";

const GAME_ICON_LABELS: Record<string, string> = {
  ageofempires: "AoE",
  apexlegends: "APEX",
  brawlstars: "BS",
  brawlhalla: "BH",
  callofduty: "CoD",
  callofdutyleague: "CDL",
  chess: "CH",
  clashofclans: "CoC",
  clashroyale: "CR",
  crossfire: "CF",
  deadlock: "DL",
  deltaforce: "DF",
  easportsfc: "FC",
  esports: "EWC",
  esportsfc: "FC",
  fighters: "FG",
  freefire: "FF",
  halo: "HALO",
  hearthstone: "HS",
  heroes: "HotS",
  honorofkings: "HoK",
  leagueoflegends: "LoL",
  marvelrivals: "MR",
  mobilelegends: "MLBB",
  naraka: "NK",
  osu: "OSU",
  overwatch: "OW",
  pubg: "PUBG",
  pubgmobile: "PUBGM",
  rainbowsix: "R6",
  rocketleague: "RL",
  simracing: "SIM",
  smash: "SSB",
  splatoon: "SPL",
  starcraft2: "SC2",
  stormgate: "SG",
  teamfighttactics: "TFT",
  teamfortress: "TF2",
  thefinals: "FIN",
  tft: "TFT",
  trackmania: "TM",
  valorant: "VCT",
  warcraft: "WC",
  warthunder: "WT",
  warzone: "WZ",
  wildrift: "WR",
  worldoftanks: "WoT",
};

const GAME_GLYPH_PATHS: Record<string, string> = {
  ageofempires: "/game-glyphs/ageofempires.svg",
  apexlegends: "/game-glyphs/apexlegends.png",
  brawlstars: "/game-glyphs/brawlstars.svg",
  brawlhalla: "/game-glyphs/brawlhalla.svg",
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

const SOURCE_GLYPH_PATHS: Record<string, string> = {
  liquipedia: "/source-glyphs/liquipedia.png",
  pandascore: "/source-glyphs/pandascore.png",
  startgg: "/source-glyphs/startgg.png",
};

function normalizedGameSlug(slug: string): string {
  const key = slug.trim().toLowerCase();
  if (key === "cs2") return "counterstrike";
  if (key === "fifa" || key === "ea-sports-fc" || key === "easportsfc") return "esportsfc";
  if (key === "teamfighttactics") return "tft";
  return key || "other";
}

function iconClass(size: GameIconSize): string {
  return size === "mark" ? "size-7" : "size-4";
}

export function GameIcon({ slug, size = "inline" }: { slug: string; size?: GameIconSize }) {
  const normalized = normalizedGameSlug(slug);
  const glyph = GAME_GLYPH_PATHS[normalized] ?? null;
  if (glyph) {
    const mask = `url("${glyph}") center / contain no-repeat`;
    return (
      <span
        className={`${iconClass(size)} inline-block shrink-0 bg-current`}
        style={{ WebkitMask: mask, mask }}
        aria-hidden
      />
    );
  }

  const label = GAME_ICON_LABELS[normalized] ?? normalized.slice(0, 3).toUpperCase();
  return (
    <span
      className={
        size === "mark"
          ? "inline-grid min-w-8 place-items-center rounded-md border border-primary/25 bg-primary/10 px-1.5 py-1 text-[0.62rem] font-bold uppercase leading-none text-primary"
          : "inline-grid min-w-5 place-items-center rounded bg-muted px-1 text-[0.5rem] font-bold uppercase leading-4 text-muted-foreground"
      }
      aria-hidden
    >
      {label}
    </span>
  );
}

export function SourceIcon({ source }: { source: string }) {
  const glyph = SOURCE_GLYPH_PATHS[source.toLowerCase()] ?? null;
  if (glyph) {
    return (
      <span className="grid size-4 shrink-0 place-items-center overflow-hidden rounded bg-muted/70 p-0.5">
        <Image src={glyph} alt="" width={14} height={14} className="size-full object-contain" />
      </span>
    );
  }
  return (
    <span className="grid size-4 place-items-center rounded bg-muted text-[0.5rem] font-bold uppercase text-muted-foreground">
      {source.slice(0, 1)}
    </span>
  );
}

export function TournamentMark({ slug }: { slug: string }) {
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-lg border bg-background text-primary">
      <GameIcon slug={slug} size="mark" />
    </span>
  );
}
