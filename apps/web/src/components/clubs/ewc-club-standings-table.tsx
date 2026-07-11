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
import { copy, directionForLocale, formatNumber, type Locale } from "@/lib/i18n";

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
    <div
      className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border bg-card"
      dir={directionForLocale(locale)}
    >
      <Table className="min-w-[960px] table-fixed" dir={directionForLocale(locale)}>
        <colgroup>
          <col className="w-[72px]" />
          <col className="w-[220px]" />
          <col className="w-[100px]" />
          <col className="w-[170px]" />
          <col className="w-[130px]" />
          <col className="w-[96px]" />
          <col className="w-[172px]" />
        </colgroup>
        <TableHeader className="bg-muted/60">
          <TableRow className="hover:bg-muted/60">
            <TableHead className="px-4 text-center">{text.columns.rank}</TableHead>
            <TableHead className="px-4">{text.columns.club}</TableHead>
            <TableHead className="px-4 text-center">{text.columns.points}</TableHead>
            <TableHead className="px-4">{text.columns.eligibility}</TableHead>
            <TableHead className="px-4 text-center whitespace-normal">{text.columns.qualifiedGames}</TableHead>
            <TableHead className="px-4 text-center">{text.columns.wins}</TableHead>
            <TableHead className="px-4">{text.columns.region}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.rank ?? "unranked"}-${row.name}`}>
              <TableCell className="px-4 text-center font-semibold tabular-nums">
                {row.rank == null ? "-" : formatNumber(row.rank, locale)}
              </TableCell>
              <TableCell className="overflow-hidden px-4">
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
              <TableCell className="px-4 text-center font-semibold tabular-nums">
                {row.points == null ? "-" : formatNumber(row.points, locale)}
              </TableCell>
              <TableCell className="px-4">
                <EligibilityBadge row={row} locale={locale} />
              </TableCell>
              <TableCell className="px-4 text-center tabular-nums">
                {formatNumber(row.qualifiedGameCount, locale)}
              </TableCell>
              <TableCell className="px-4 text-center tabular-nums">
                {formatNumber(row.wins, locale)}
              </TableCell>
              <TableCell className="overflow-hidden px-4">
                <p className="truncate text-sm">{clubsText.regions[row.region]}</p>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
