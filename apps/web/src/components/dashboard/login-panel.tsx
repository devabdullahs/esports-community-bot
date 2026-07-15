"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowRightIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { signIn } from "@/lib/auth-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DiscordIcon } from "@/components/discord-icon";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldSeparator,
} from "@/components/ui/field";
import {
  copy,
  localizedPath,
  type Locale,
} from "@/lib/i18n";
import { loginCallbackUrl } from "@/lib/login-navigation";

export function LoginPanel({ locale }: { locale: Locale }) {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const text = copy[locale].login;
  const callbackURL = loginCallbackUrl(searchParams.get("callbackURL"), locale);

  async function onSignIn() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setError(null);
    setPending(true);

    try {
      const result = await signIn.social({
        provider: "discord",
        callbackURL,
      });
      if (result?.error) {
        setError(text.failedMessage);
      }
    } catch {
      setError(text.failedMessage);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return <LoginPanelContent locale={locale} pending={pending} error={error} onSignIn={onSignIn} />;
}

export function LoginPanelContent({
  locale,
  pending = false,
  error = null,
  onSignIn,
}: {
  locale: Locale;
  pending?: boolean;
  error?: string | null;
  onSignIn?: () => void;
}) {
  const text = copy[locale].login;
  const common = copy[locale].common;

  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader className="flex flex-row items-center gap-3 text-start">
        <Image src="/icon.svg" alt="" width={40} height={40} className="size-10 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="text-xl">{text.title}</CardTitle>
          <CardDescription>{text.description}</CardDescription>
        </div>
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
            <Button onClick={onSignIn} disabled={pending} aria-busy={pending} size="lg" className="w-full">
              <DiscordIcon data-icon="inline-start" />
              {pending ? text.pending : text.continue}
            </Button>
          </Field>
          <FieldSeparator>{text.trust}</FieldSeparator>
          <Field>
            <Button
              render={<Link href={localizedPath("/", locale)} />}
              nativeButton={false}
              variant="outline"
              size="lg"
              className="w-full"
            >
              {text.browse}
              <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
            </Button>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-center text-sm leading-6 text-muted-foreground">
          {text.legalPrefix}{" "}
          <Link
            href={localizedPath("/terms", locale)}
            className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {common.termsOfService}
          </Link>{" "}
          {text.legalAnd}{" "}
          <Link
            href={localizedPath("/privacy", locale)}
            className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {common.privacyPolicy}
          </Link>.
        </p>
      </CardFooter>
    </Card>
  );
}
