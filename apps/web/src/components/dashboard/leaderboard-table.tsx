"use client";

/* eslint-disable react-hooks/incompatible-library */

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDownUpIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PredictionAchievementBadges } from "@/components/predictions/prediction-achievement-badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  copy,
  formatNumber,
  localizedPath,
  type Locale,
} from "@/lib/i18n";

export type LeaderboardRow = {
  rank: number;
  displayName: string;
  avatarUrl?: string | null;
  profileHref?: string | null;
  overallPoints: number;
  weeksScored: number;
  weeklyWins: number;
  top3Sweeps: number;
  achievementIds?: string[];
  topTeams: string[];
};

export function LeaderboardTable({
  rows,
  locale,
}: {
  rows: LeaderboardRow[];
  locale: Locale;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const text = copy[locale];

  const columns = useMemo<ColumnDef<LeaderboardRow>[]>(
    () => [
      {
        accessorKey: "rank",
        header: text.common.rank,
        cell: ({ row }) => {
          const rank = row.original.rank;
          const medal =
            rank === 1
              ? "border-amber-500/45 bg-amber-500/15 text-amber-600 dark:text-amber-400"
              : rank === 2
                ? "border-slate-400/45 bg-slate-400/15 text-slate-600 dark:text-slate-300"
                : rank === 3
                  ? "border-orange-600/45 bg-orange-600/15 text-orange-700 dark:text-orange-400"
                  : undefined;
          return (
            <Badge variant="outline" className={medal}>
              #{formatNumber(rank, locale)}
            </Badge>
          );
        },
      },
      {
        accessorKey: "displayName",
        header: text.common.member,
        cell: ({ row }) => {
          const member = (
            <div className="flex min-w-0 items-center gap-2 sm:min-w-44">
            <Avatar size="sm">
              <AvatarImage src={row.original.avatarUrl || undefined} alt="" />
              <AvatarFallback>{row.original.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <span className="block truncate font-medium">{row.original.displayName}</span>
              <PredictionAchievementBadges achievementIds={row.original.achievementIds} locale={locale} className="mt-1" />
            </div>
            </div>
          );
          return row.original.profileHref ? (
            <Link
              href={localizedPath(row.original.profileHref, locale)}
              className="block rounded-sm outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              {member}
            </Link>
          ) : member;
        },
      },
      {
        accessorKey: "overallPoints",
        header: ({ column }) => (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="-me-2"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              {text.common.points}
              <ArrowDownUpIcon data-icon="inline-end" />
            </Button>
          </div>
        ),
        cell: ({ row }) => (
          <span className="block text-end font-mono tabular-nums">
            {formatNumber(row.original.overallPoints, locale)}
          </span>
        ),
      },
      {
        accessorKey: "weeksScored",
        header: () => <div className="text-end">{text.common.weeks}</div>,
        cell: ({ row }) => (
          <span className="block text-end tabular-nums">
            {formatNumber(row.original.weeksScored, locale)}
          </span>
        ),
      },
      {
        accessorKey: "weeklyWins",
        header: () => <div className="text-end">{text.common.wins}</div>,
        cell: ({ row }) => (
          <span className="block text-end tabular-nums">
            {formatNumber(row.original.weeklyWins, locale)}
          </span>
        ),
      },
      {
        accessorKey: "top3Sweeps",
        header: () => <div className="text-end">{text.common.sweeps}</div>,
        cell: ({ row }) => (
          <span className="block text-end tabular-nums">
            {formatNumber(row.original.top3Sweeps, locale)}
          </span>
        ),
      },
      {
        accessorKey: "topTeams",
        header: text.common.topTeams,
        cell: ({ row }) => (
          <div className="flex min-w-48 flex-wrap gap-1 sm:min-w-56">
            {row.original.topTeams.length ? (
              row.original.topTeams.map((team) => (
                <Badge key={team} variant="secondary">
                  {team}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </div>
        ),
      },
    ],
    [locale, text],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          placeholder={text.leaderboard.searchPagePlaceholder}
          className="ps-8"
        />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={row.original.rank <= 3 ? "bg-primary/[0.05]" : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {text.leaderboard.empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
