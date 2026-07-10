"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe2Icon } from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { copy, type Locale } from "@/lib/i18n";

type IdentityPayload = {
  user: { name?: string | null; image?: string | null };
  link: {
    publicIdentityEnabled?: boolean;
    publicDisplayName?: string | null;
  } | null;
};

async function jsonOrThrow(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body;
}

export function PublicPredictionIdentitySettings({ locale }: { locale: Locale }) {
  const text = copy[locale].profile;
  const queryClient = useQueryClient();
  const query = useQuery<IdentityPayload>({
    queryKey: ["me-ewc-public-identity"],
    queryFn: () => jsonOrThrow(fetch("/api/me/ewc")),
  });
  const mutation = useMutation({
    mutationFn: async (enabled: boolean) => jsonOrThrow(await fetch("/api/me/ewc/public-identity", { method: enabled ? "POST" : "DELETE" })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["me-ewc-public-identity"] });
      void queryClient.invalidateQueries({ queryKey: ["me-ewc"] });
    },
  });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const enabled = Boolean(query.data?.link?.publicIdentityEnabled);
  const name = query.data?.user.name || query.data?.link?.publicDisplayName || text.publicIdentityAnonymous;
  const avatar = query.data?.user.image || undefined;
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{text.publicIdentityTitle}</CardTitle>
        <CardDescription>{text.publicIdentityDescription}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field data-disabled={!query.data?.link || mutation.isPending || undefined}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <FieldLabel htmlFor="public-prediction-identity">{text.publicIdentityLabel}</FieldLabel>
              <FieldDescription>{text.publicIdentityHelp}</FieldDescription>
            </div>
            <Switch
              id="public-prediction-identity"
              checked={enabled}
              disabled={!query.data?.link || mutation.isPending}
              onCheckedChange={(next) => {
                if (next) setConfirmOpen(true);
                else mutation.mutate(false);
              }}
            />
          </div>
        </Field>
        <div className="flex min-w-0 items-center gap-3 rounded-lg border p-3">
          <Avatar size="lg">
            <AvatarImage src={avatar} alt="" />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{name}</p>
            <p className="text-sm text-muted-foreground">{text.publicIdentityPreview}</p>
          </div>
          <Badge variant={enabled ? "secondary" : "outline"}>
            <Globe2Icon data-icon="inline-start" />
            {enabled ? text.publicIdentityEnabled : text.publicIdentityDisabled}
          </Badge>
        </div>
        {mutation.error ? <p className="text-sm text-destructive">{mutation.error.message}</p> : null}
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={text.publicIdentityConfirmTitle}
        description={text.publicIdentityConfirmDescription}
        cancelLabel={text.publicIdentityCancel}
        actions={[{ label: text.publicIdentityEnable, onClick: () => { mutation.mutate(true); setConfirmOpen(false); } }]}
      />
    </Card>
  );
}
