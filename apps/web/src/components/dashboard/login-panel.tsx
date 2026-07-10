"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { signIn } from "@/lib/auth-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DiscordIcon } from "@/components/discord-icon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldSeparator,
} from "@/components/ui/field";
import {
  copy,
  localizedPath,
  type Locale,
} from "@/lib/i18n";

export function LoginPanel({ locale }: { locale: Locale }) {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const text = copy[locale].login;
  const common = copy[locale].common;
  const callbackURL = searchParams.get("callbackURL") || localizedPath("/me", locale);

  async function onSignIn() {
    setError(null);
    setPending(true);
    const result = await signIn.social({
      provider: "discord",
      callbackURL,
    });
    if (result?.error) {
      const message = (result.error && typeof result.error.message === "string" && result.error.message) || text.failedMessage;
      setError(message);
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{text.title}</CardTitle>
          <CardDescription>{text.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {error ? (
              <Field>
                <Alert variant="destructive">
                  <AlertTitle>{text.failedTitle}</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </Field>
            ) : null}
            <Field>
              <Button onClick={onSignIn} disabled={pending}>
                <DiscordIcon data-icon="inline-start" />
                {pending ? text.pending : text.continue}
              </Button>
            </Field>
            <FieldSeparator>
              {locale === "ar"
                ? "\u0622\u0645\u0646 \u0648\u0645\u062e\u0635\u0635 \u0644\u0644\u0645\u062c\u062a\u0645\u0639"
                : "Secure community access"}
            </FieldSeparator>
            <Field>
              <FieldDescription className="text-center">
                {text.legalPrefix}{" "}
                <Link href={localizedPath("/terms", locale)}>{common.termsOfService}</Link>
                {" "}
                {text.legalAnd}{" "}
                <Link href={localizedPath("/privacy", locale)}>{common.privacyPolicy}</Link>.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  );
}
