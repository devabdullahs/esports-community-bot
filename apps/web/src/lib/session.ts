import "server-only";

import { headers } from "next/headers";
import { auth, type Session } from "@/lib/auth";
import { devSession, isDevAuthBypassEnabled } from "@/lib/dev-auth";

export async function getAuthSession(): Promise<Session | null> {
  return auth.api.getSession({ headers: await headers() });
}

export async function getOptionalSession(): Promise<Session | null> {
  const session = await getAuthSession();
  if (session) return session;
  return isDevAuthBypassEnabled() ? devSession() : null;
}
