import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const maxWidthClasses = {
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
} as const;

export function AdminPageShell({
  backHref,
  backLabel,
  eyebrow,
  title,
  description,
  badge,
  actions,
  children,
  maxWidth = "4xl",
}: {
  backHref?: string;
  backLabel?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  badge?: string;
  actions?: ReactNode;
  children: ReactNode;
  maxWidth?: keyof typeof maxWidthClasses;
}) {
  return (
    <main
      className={cn(
        "mx-auto flex w-full flex-1 flex-col gap-7 px-5 py-8 sm:px-8 lg:py-10",
        maxWidthClasses[maxWidth],
      )}
    >
      {backHref && backLabel ? (
        <Button
          render={<Link href={backHref} />}
          nativeButton={false}
          variant="ghost"
          className="-ms-2 w-fit text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
          {backLabel}
        </Button>
      ) : null}

      <Card className="overflow-hidden border-border/70 bg-card/70 shadow-sm">
        <CardHeader className="gap-5 border-b border-border/60 bg-muted/10 p-6 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex min-w-0 flex-col gap-3">
              {eyebrow ? (
                <p className="text-sm font-medium text-primary">{eyebrow}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-balance text-3xl leading-tight sm:text-4xl">
                  {title}
                </CardTitle>
                {badge ? <Badge variant="secondary">{badge}</Badge> : null}
              </div>
              {description ? (
                <CardDescription className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  {description}
                </CardDescription>
              ) : null}
            </div>
            {actions ? (
              <CardAction className="flex shrink-0 flex-wrap items-start justify-end gap-2">
                {actions}
              </CardAction>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      {children}
    </main>
  );
}
