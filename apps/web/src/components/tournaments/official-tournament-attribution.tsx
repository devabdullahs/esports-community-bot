const OFFICIAL_ATTRIBUTION = "© Esports Foundation 2026. All rights reserved.";

export function OfficialTournamentAttribution({ value }: { value?: string | null }) {
  if (value !== OFFICIAL_ATTRIBUTION) return null;
  return (
    <p className="text-xs text-muted-foreground" dir="ltr">
      <strong>
        <em>{OFFICIAL_ATTRIBUTION}</em>
      </strong>
    </p>
  );
}
