import { ProfileAvatar } from "@/components/profiles/profile-avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EwcClubStandingRow } from "@/lib/ewc-club-standings";
import { copy, formatNumber, type Locale } from "@/lib/i18n";

function EligibilityBadge({ row, locale }: { row: EwcClubStandingRow; locale: Locale }) {
  const text = copy[locale].ewcClubStandings.eligibility;
  if (row.eligibility === "champion") {
    return <Badge variant="secondary">{text.champion}</Badge>;
  }
  if (row.eligibility === "prize") {
    return <Badge variant="outline">{text.prize}</Badge>;
  }
  return <span className="text-xs text-muted-foreground">{text.unknown}</span>;
}

export function EwcClubStandingsTable({
  rows,
  locale,
}: {
  rows: EwcClubStandingRow[];
  locale: Locale;
}) {
  const text = copy[locale].ewcClubStandings;
  const clubsText = copy[locale].ewcClubs;

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border bg-card">
      <Table className="min-w-[820px] table-fixed">
        <colgroup>
          <col className="w-14" />
          <col className="w-[180px]" />
          <col className="w-[88px]" />
          <col className="w-40" />
          <col className="w-[104px]" />
          <col className="w-[72px]" />
          <col className="w-40" />
        </colgroup>
        <TableHeader className="bg-muted/60">
          <TableRow className="hover:bg-muted/60">
            <TableHead className="text-center">{text.columns.rank}</TableHead>
            <TableHead>{text.columns.club}</TableHead>
            <TableHead className="text-end">{text.columns.points}</TableHead>
            <TableHead>{text.columns.eligibility}</TableHead>
            <TableHead className="text-end whitespace-normal">{text.columns.qualifiedGames}</TableHead>
            <TableHead className="text-end">{text.columns.wins}</TableHead>
            <TableHead>{text.columns.region}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.rank ?? "unranked"}-${row.name}`}>
              <TableCell className="text-center font-semibold tabular-nums">
                {row.rank == null ? "-" : formatNumber(row.rank, locale)}
              </TableCell>
              <TableCell className="overflow-hidden">
                <div className="flex min-w-0 items-center gap-2">
                  <ProfileAvatar
                    src={row.logo}
                    name={row.name}
                    shape="rounded"
                    fit="contain"
                    className="size-8 shrink-0 border border-border"
                  />
                  <span className="min-w-0 truncate font-medium" dir="auto">
                    {row.name}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-end font-semibold tabular-nums">
                {row.points == null ? "-" : formatNumber(row.points, locale)}
              </TableCell>
              <TableCell>
                <EligibilityBadge row={row} locale={locale} />
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {formatNumber(row.qualifiedGameCount, locale)}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {formatNumber(row.wins, locale)}
              </TableCell>
              <TableCell className="overflow-hidden">
                <p className="truncate text-sm">{clubsText.regions[row.region]}</p>
                {row.locationLabel ? (
                  <p className="truncate text-xs text-muted-foreground" dir="auto">
                    {row.locationLabel}
                  </p>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
