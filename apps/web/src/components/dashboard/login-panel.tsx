"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { LogInIcon } from "lucide-react";
import { signIn } from "@/lib/auth-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  copy,
  type Locale,
} from "@/lib/i18n";

export function LoginPanel({ locale }: { locale: Locale }) {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const text = copy[locale].login;
  const callbackURL = searchParams.get("callbackURL") || "/me";

  async function onSignIn() {
    setError(null);
    const result = await signIn.social({
      provider: "discord",
      callbackURL,
    });
    if (result?.error) setError(result.error.message || text.failedMessage);
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{text.title}</CardTitle>
        <CardDescription>{text.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{text.failedTitle}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button onClick={onSignIn}>
          <LogInIcon data-icon="inline-start" />
          {text.continue}
        </Button>
      </CardContent>
    </Card>
  );
}
