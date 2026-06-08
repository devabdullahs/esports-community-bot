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

export function LoginPanel() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const callbackURL = searchParams.get("callbackURL") || "/me";

  async function onSignIn() {
    setError(null);
    const result = await signIn.social({
      provider: "discord",
      callbackURL,
    });
    if (result?.error) setError(result.error.message || "Discord sign-in failed.");
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Discord sign in</CardTitle>
        <CardDescription>Connect your Discord account to manage your EWC profile showcase.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Sign in failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button onClick={onSignIn}>
          <LogInIcon data-icon="inline-start" />
          Continue with Discord
        </Button>
      </CardContent>
    </Card>
  );
}
