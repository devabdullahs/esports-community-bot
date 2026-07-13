export const ANALYTICS_CONSENT_KEY = "ec_analytics_consent_v1";
export const ANALYTICS_SETTINGS_EVENT = "ec:analytics-settings";
export const ANALYTICS_CONSENT_CHANGED_EVENT = "ec:analytics-consent-changed";

export type GoogleAnalyticsConsent = "granted" | "denied";

const MEASUREMENT_ID_RE = /^G-[A-Z0-9]{6,20}$/;

export function normalizeGoogleAnalyticsMeasurementId(value: string | null | undefined) {
  const measurementId = value?.trim().toUpperCase() || "";
  return MEASUREMENT_ID_RE.test(measurementId) ? measurementId : null;
}

export function parseGoogleAnalyticsConsent(value: string | null | undefined): GoogleAnalyticsConsent | null {
  return value === "granted" || value === "denied" ? value : null;
}

export function enqueueGoogleTagCommand(dataLayer: unknown[], ...command: unknown[]) {
  const gtag: (...args: unknown[]) => void = function () {
    // gtag.js requires the function's Arguments object, not a plain array.
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  };

  gtag(...command);
}

export function shouldLoadGoogleAnalytics({
  measurementId,
  consent,
  globalPrivacyControl = false,
}: {
  measurementId: string | null | undefined;
  consent: GoogleAnalyticsConsent | null;
  globalPrivacyControl?: boolean;
}) {
  return Boolean(
    normalizeGoogleAnalyticsMeasurementId(measurementId) &&
      consent === "granted" &&
      !globalPrivacyControl,
  );
}
