/**
 * Stub for next/cache in the test environment.
 * revalidateTag / revalidatePath throw "Invariant: static generation store
 * missing" in vitest because the Next.js server context is absent.  Replacing
 * them with no-ops keeps existing authz tests green while still letting the
 * cache-invalidation tests spy on the functions they import.
 */
export const revalidateTag = () => undefined;
export const revalidatePath = () => undefined;
export const unstable_cache = <T>(fn: (...args: unknown[]) => T) => fn;
