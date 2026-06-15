import { LocalDateTime } from "@/components/local-date-time";
import { formatDateTime, type DateTimeValue, type Locale } from "@/lib/i18n";

export function DateTime({
  value,
  locale,
  className,
}: {
  value: DateTimeValue;
  locale: Locale;
  className?: string;
}) {
  return (
    <LocalDateTime
      value={value}
      locale={locale}
      fallback={formatDateTime(value, locale)}
      className={className}
    />
  );
}
