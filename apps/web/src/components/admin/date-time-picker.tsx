"use client";

import { CalendarClockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DateTimePickerProps = {
  value: string;
  min?: string;
  locale: "en" | "ar";
  onChange: (value: string) => void;
};

const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

function parseWallTime(value: string): { date: Date; time: string } | null {
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) return null;
  const [, year, month, day, hour = "12", minute = "00"] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 12);
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) return null;
  return { date, time: `${hour}:${minute}` };
}

function datePart(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DateTimePicker({ value, min, locale, onChange }: DateTimePickerProps) {
  const parsed = parseWallTime(value);
  const minimum = min ? parseWallTime(min) : null;
  const language = locale === "ar" ? "ar-SA-u-ca-gregory" : "en-US";
  const copy = locale === "ar"
    ? { choose: "اختر التاريخ والوقت", date: "التاريخ", time: "الوقت" }
    : { choose: "Choose date and time", date: "Date", time: "Time" };

  const label = parsed
    ? `${new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(parsed.date)} · ${new Intl.DateTimeFormat(language, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, Number(parsed.time.slice(0, 2)), Number(parsed.time.slice(3, 5))))}`
    : copy.choose;

  function selectDate(date: Date | undefined) {
    if (!date) return;
    onChange(`${datePart(date)}T${parsed?.time ?? "12:00"}`);
  }

  function selectTime(time: string) {
    if (!/^\d{2}:\d{2}$/.test(time)) return;
    const date = parsed?.date ?? minimum?.date ?? new Date();
    onChange(`${datePart(date)}T${time}`);
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className={cn(
              "w-full justify-start font-normal sm:max-w-sm",
              !parsed && "text-muted-foreground",
            )}
          />
        }
      >
        <CalendarClockIcon data-icon="inline-start" />
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] gap-0 p-0">
        <Field className="gap-1 border-b px-3 py-2.5">
          <FieldLabel className="text-xs text-muted-foreground">{copy.date}</FieldLabel>
          <Calendar
            mode="single"
            selected={parsed?.date}
            onSelect={selectDate}
            disabled={minimum ? { before: minimum.date } : undefined}
          />
        </Field>
        <Field className="gap-1 px-3 py-3">
          <FieldLabel htmlFor="scheduled-publish-time" className="text-xs text-muted-foreground">
            {copy.time}
          </FieldLabel>
          <Input
            id="scheduled-publish-time"
            type="time"
            value={parsed?.time ?? "12:00"}
            onChange={(event) => selectTime(event.target.value)}
            className="w-full"
            dir="ltr"
          />
        </Field>
      </PopoverContent>
    </Popover>
  );
}
