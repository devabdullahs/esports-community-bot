import "server-only";

import { headers } from "next/headers";
import { auth, type Session } from "@/lib/auth";
import { devSession, isDevAuthBypassEnabled } from "@/lib/dev-auth";

export async function getOptionalSession(): Promise<Session | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) return session;
  return isDevAuthBypassEnabled() ? devSession() : null;
}
