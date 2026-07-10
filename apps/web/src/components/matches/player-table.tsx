"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DotaPlayer, ValorantPlayer } from "@/lib/match-details";
import { copy, type Locale } from "@/lib/i18n";

type MatchDetailsCopy = {
  matchDetailsPlayerPerformance: string;
  matchDetailsShowMore: (count: number) => string;
  matchDetailsShowLess: string;
};

function PlayerTableFooter({
  total,
  shown,
  onToggle,
  text,
}: {
  total: number;
  shown: number;
  onToggle: () => void;
  text: MatchDetailsCopy;
}) {
  if (total <= 3) return null;
  return (
    <div className="flex justify-center pt-2">
      <Button variant="ghost" size="sm" onClick={onToggle}>
        {shown < total ? text.matchDetailsShowMore(total - shown) : text.matchDetailsShowLess}
      </Button>
    </div>
  );
}

export function ValorantPlayerTable({
  players,
  locale,
}: {
  players: ValorantPlayer[];
  locale: Locale;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = copy[locale].tournaments;
  const shown = expanded ? players.length : Math.min(players.length, 3);
  return (
    <div className="min-w-0" dir="ltr">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead className="text-end">ACS</TableHead>
              <TableHead className="text-end">KDA</TableHead>
              <TableHead className="text-end">KAST</TableHead>
              <TableHead className="text-end">ADR</TableHead>
              <TableHead className="text-end">HS%</TableHead>
              <TableHead className="text-end">FK / FD</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {players.slice(0, shown).map((player, index) => (
              <TableRow key={`${player.name ?? "player"}-${index}`}>
                <TableCell className="font-medium">{player.name ?? "-"}</TableCell>
                <TableCell>{player.agents.join(", ") || "-"}</TableCell>
                <TableCell className="text-end tabular-nums">{player.acs ?? "-"}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {[player.kills, player.deaths, player.assists].every((value) => value != null)
                    ? `${player.kills}/${player.deaths}/${player.assists}`
                    : "-"}
                </TableCell>
                <TableCell className="text-end tabular-nums">{player.kastPct ?? "-"}</TableCell>
                <TableCell className="text-end tabular-nums">{player.adr ?? "-"}</TableCell>
                <TableCell className="text-end tabular-nums">{player.hsPct ?? "-"}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {player.fk != null && player.fd != null ? `${player.fk}/${player.fd}` : "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <PlayerTableFooter total={players.length} shown={shown} onToggle={() => setExpanded((value) => !value)} text={text} />
    </div>
  );
}

export function DotaPlayerTable({
  players,
  locale,
}: {
  players: DotaPlayer[];
  locale: Locale;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = copy[locale].tournaments;
  const shown = expanded ? players.length : Math.min(players.length, 3);
  return (
    <div className="min-w-0" dir="ltr">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead>Hero</TableHead>
              <TableHead className="text-end">KDA</TableHead>
              <TableHead className="text-end">DMG</TableHead>
              <TableHead className="text-end">LH/DN</TableHead>
              <TableHead className="text-end">NET</TableHead>
              <TableHead className="text-end">GPM</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {players.slice(0, shown).map((player, index) => (
              <TableRow key={`${player.name ?? "player"}-${index}`}>
                <TableCell className="font-medium">{player.name ?? "-"}</TableCell>
                <TableCell>{player.hero ?? "-"}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {[player.kills, player.deaths, player.assists].every((value) => value != null)
                    ? `${player.kills}/${player.deaths}/${player.assists}`
                    : "-"}
                </TableCell>
                <TableCell className="text-end tabular-nums">{player.dmg ?? "-"}</TableCell>
                <TableCell className="text-end tabular-nums">{player.lhdn ?? "-"}</TableCell>
                <TableCell className="text-end tabular-nums">{player.net ?? "-"}</TableCell>
                <TableCell className="text-end tabular-nums">{player.gpm ?? "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <PlayerTableFooter total={players.length} shown={shown} onToggle={() => setExpanded((value) => !value)} text={text} />
    </div>
  );
}
