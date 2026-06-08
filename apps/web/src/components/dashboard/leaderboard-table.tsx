"use client";

/* eslint-disable react-hooks/incompatible-library */

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDownUpIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  type Locale,
} from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type LeaderboardRow = {
  rank: number;
  userId: string;
  displayName: string;
  overallPoints: number;
  weeksScored: number;
  weeklyWins: number;
  top3Sweeps: number;
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
          return (
            <Badge variant={rank <= 3 ? "default" : "outline"}>
              #{formatNumber(rank, locale)}
            </Badge>
          );
        },
      },
      {
        accessorKey: "displayName",
        header: text.common.member,
        cell: ({ row }) => (
          <div className="flex min-w-44 flex-col">
            <span className="font-medium">{row.original.displayName}</span>
            <span className="font-mono text-xs text-muted-foreground" dir="ltr">
              {row.original.userId}
            </span>
          </div>
        ),
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
          <div className="flex min-w-56 flex-wrap gap-1">
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
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          placeholder={text.leaderboard.searchPlaceholder}
          className="ps-8"
        />
      </div>
      <div className="overflow-hidden rounded-md border">
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
                  className={cn(
                    row.original.rank <= 3 && "bg-primary/5 dark:bg-primary/10",
                    row.original.rank === 1 && "border-s-2 border-s-primary",
                  )}
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
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {text.leaderboard.page(table.getState().pagination.pageIndex + 1, table.getPageCount() || 1)}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            {text.common.previous}
          </Button>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            {text.common.next}
          </Button>
        </div>
      </div>
    </div>
  );
}
