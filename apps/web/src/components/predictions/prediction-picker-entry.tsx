"use client";

import { useQuery } from "@tanstack/react-query";
import { WebPredictionPicker } from "@/components/predictions/web-prediction-picker";
import type { Locale } from "@/lib/i18n";

type PickerPayload = {
  picker: Parameters<typeof WebPredictionPicker>[0]["picker"];
};

export function PredictionPickerEntry({ locale }: { locale: Locale }) {
  const query = useQuery<PickerPayload | null>({
    queryKey: ["me-ewc", "", "2026"],
    queryFn: async () => {
      const response = await fetch("/api/me/ewc?season=2026");
      if (response.status === 401) return null;
      if (!response.ok) throw new Error("Unable to load prediction picks.");
      return response.json();
    },
    retry: false,
  });
  if (!query.data?.picker) return null;
  return <WebPredictionPicker picker={query.data.picker} locale={locale} queryKey={["me-ewc", "", "2026"]} />;
}
