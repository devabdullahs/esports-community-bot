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
        "mx-auto flex w-full flex-1 flex-col gap-6 px-5 py-10 sm:px-8",
        maxWidthClasses[maxWidth],
      )}
    >
      {backHref && backLabel ? (
        <Button
          render={<Link href={backHref} />}
          nativeButton={false}
          variant="ghost"
          className="w-fit"
        >
          <ArrowLeftIcon data-icon="inline-start" />
          {backLabel}
        </Button>
      ) : null}

      <Card className="overflow-hidden bg-card/60">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-2">
              {eyebrow ? <p className="text-sm text-muted-foreground">{eyebrow}</p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-3xl leading-tight">{title}</CardTitle>
                {badge ? <Badge variant="secondary">{badge}</Badge> : null}
              </div>
              {description ? (
                <CardDescription className="max-w-3xl text-sm">{description}</CardDescription>
              ) : null}
            </div>
            {actions ? <CardAction className="shrink-0">{actions}</CardAction> : null}
          </div>
        </CardHeader>
      </Card>

      {children}
    </main>
  );
}
