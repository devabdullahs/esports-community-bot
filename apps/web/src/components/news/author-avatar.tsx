import { safeUrlOrUndefined } from "@/lib/safe-url";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Round Discord avatar with an initials fallback for authors who never signed in
// to the dashboard (so we have no stored avatar URL). Size via `className`.
export function AuthorAvatar({
  name,
  avatarUrl,
  className,
}: {
  name: string;
  avatarUrl: string | null;
  className?: string;
}) {
  const safe = safeUrlOrUndefined(avatarUrl);
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[0.7em] font-medium text-muted-foreground",
        className,
      )}
      aria-hidden
    >
      {safe ? (
        // eslint-disable-next-line @next/next/no-img-element -- validated http(s) avatar URL
        <img src={safe} alt="" className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
