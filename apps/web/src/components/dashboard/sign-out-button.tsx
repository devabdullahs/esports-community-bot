"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOutIcon } from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function SignOutButton({
  label,
  redirectTo = "/",
  className,
}: {
  label: string;
  redirectTo?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onSignOut() {
    setPending(true);
    try {
      await signOut();
    } finally {
      router.push(redirectTo);
      router.refresh();
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onSignOut}
      disabled={pending}
      className={className}
    >
      <LogOutIcon data-icon="inline-start" />
      {label}
    </Button>
  );
}
