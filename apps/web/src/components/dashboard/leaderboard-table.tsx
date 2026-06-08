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

export function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const columns = useMemo<ColumnDef<LeaderboardRow>[]>(
    () => [
      {
        accessorKey: "rank",
        header: "Rank",
        cell: ({ row }) => {
          const rank = row.original.rank;
          const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
          return (
            <span className={cn("font-mono tabular-nums", rank <= 3 && "font-semibold text-primary")}>
              {medal ? <span className="mr-1">{medal}</span> : null}#{rank}
            </span>
          );
        },
      },
      {
        accessorKey: "displayName",
        header: "Member",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.displayName}</span>
            <span className="font-mono text-xs text-muted-foreground">{row.original.userId}</span>
          </div>
        ),
      },
      {
        accessorKey: "overallPoints",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Points
            <ArrowDownUpIcon data-icon="inline-end" />
          </Button>
        ),
        cell: ({ row }) => <span className="font-mono">{row.original.overallPoints.toLocaleString()}</span>,
      },
      {
        accessorKey: "weeksScored",
        header: "Weeks",
      },
      {
        accessorKey: "weeklyWins",
        header: "Wins",
      },
      {
        accessorKey: "top3Sweeps",
        header: "Sweeps",
      },
      {
        accessorKey: "topTeams",
        header: "Top teams",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
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
    [],
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
      <div className="flex max-w-sm items-center gap-2">
        <SearchIcon data-icon="inline-start" />
        <Input
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          placeholder="Search members or teams"
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
                <TableRow key={row.id} className={cn(row.original.rank <= 3 && "bg-primary/[0.04]")}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No ranked predictions yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
