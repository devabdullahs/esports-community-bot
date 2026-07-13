"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3Icon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ANALYTICS_CONSENT_CHANGED_EVENT,
  ANALYTICS_CONSENT_KEY,
  ANALYTICS_SETTINGS_EVENT,
  normalizeGoogleAnalyticsMeasurementId,
  parseGoogleAnalyticsConsent,
  shouldLoadGoogleAnalytics,
  type GoogleAnalyticsConsent,
} from "@/lib/google-analytics";
import { localizedPath, type Locale } from "@/lib/i18n";

const SCRIPT_ID = "ec-google-analytics";

type GoogleAnalyticsWindow = Window & {
  dataLayer?: unknown[][];
  gtag?: (...args: unknown[]) => void;
  __ecGoogleAnalyticsId?: string;
};

const COPY = {
  en: {
    title: "Optional website analytics",
    description:
      "Allow privacy-conscious analytics, including Google Analytics, to help us understand visits and improve the site. Analytics stays off until you accept, and advertising features remain disabled.",
    privacySignal:
      "Your browser is sending a privacy signal, so Google Analytics will remain disabled.",
    reject: "Keep disabled",
    allow: "Allow analytics",
    privacy: "Privacy policy",
  },
  ar: {
    title: "إحصائيات الموقع الاختيارية",
    description:
      "اسمح بإحصائيات تراعي الخصوصية، بما فيها Google Analytics، لمساعدتنا على فهم الزيارات وتحسين الموقع. تبقى الإحصائيات متوقفة حتى توافق، وتظل ميزات الإعلانات معطلة.",
    privacySignal:
      "يرسل متصفحك إشارة خصوصية، لذلك سيبقى Google Analytics معطلاً.",
    reject: "إبقاؤها معطلة",
    allow: "السماح بالإحصائيات",
    privacy: "سياسة الخصوصية",
  },
} as const;

function storageGet(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The current-page choice still applies when browser storage is unavailable.
  }
}

function privacySignals() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return {
    globalPrivacyControl: nav.globalPrivacyControl === true,
  };
}

function queueGtag(...args: unknown[]) {
  const analyticsWindow = window as GoogleAnalyticsWindow;
  analyticsWindow.dataLayer = analyticsWindow.dataLayer || [];
  analyticsWindow.dataLayer.push(args);
}

function enableGoogleAnalytics(measurementId: string) {
  const analyticsWindow = window as GoogleAnalyticsWindow;
  analyticsWindow.gtag = queueGtag;

  if (analyticsWindow.__ecGoogleAnalyticsId !== measurementId) {
    queueGtag("consent", "default", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      functionality_storage: "granted",
      security_storage: "granted",
    });
    queueGtag("consent", "update", {
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    queueGtag("js", new Date());
    queueGtag("config", measurementId, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    analyticsWindow.__ecGoogleAnalyticsId = measurementId;
  } else {
    queueGtag("consent", "update", {
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
  }

  if (!document.getElementById(SCRIPT_ID)) {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);
  }
}

function clearGoogleAnalyticsCookies() {
  const hostname = window.location.hostname;
  const labels = hostname.split(".");
  const domains = new Set([hostname, `.${hostname}`]);
  if (labels.length > 2) domains.add(`.${labels.slice(-2).join(".")}`);
  const cookieNames = document.cookie
    .split(";")
    .map((cookie) => cookie.trim().split("=")[0])
    .filter((name) => name === "_ga" || name.startsWith("_ga_"));

  for (const name of cookieNames) {
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${domain}; SameSite=Lax`;
    }
  }
}

function disableGoogleAnalytics() {
  const analyticsWindow = window as GoogleAnalyticsWindow;
  if (analyticsWindow.gtag) {
    queueGtag("consent", "update", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
  }
  clearGoogleAnalyticsCookies();
}

export function GoogleAnalyticsConsentBanner({
  measurementId: rawMeasurementId,
  locale,
}: {
  measurementId: string;
  locale: Locale;
}) {
  const pathname = usePathname();
  const measurementId = normalizeGoogleAnalyticsMeasurementId(rawMeasurementId);
  const [consent, setConsent] = useState<GoogleAnalyticsConsent | null | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [globalPrivacyControl, setGlobalPrivacyControl] = useState(false);
  const text = COPY[locale];

  useEffect(() => {
    const openSettings = () => setSettingsOpen(true);
    window.addEventListener(ANALYTICS_SETTINGS_EVENT, openSettings);
    const initialize = window.setTimeout(() => {
      const signals = privacySignals();
      setGlobalPrivacyControl(signals.globalPrivacyControl);
      setConsent(parseGoogleAnalyticsConsent(storageGet(ANALYTICS_CONSENT_KEY)));
    }, 0);
    return () => {
      window.clearTimeout(initialize);
      window.removeEventListener(ANALYTICS_SETTINGS_EVENT, openSettings);
    };
  }, []);

  useEffect(() => {
    if (!measurementId || consent === undefined) return;
    const signals = privacySignals();
    if (
      shouldLoadGoogleAnalytics({
        measurementId,
        consent,
        ...signals,
      })
    ) {
      enableGoogleAnalytics(measurementId);
    } else {
      disableGoogleAnalytics();
    }
  }, [consent, measurementId]);

  useEffect(() => {
    if (!pathname || !measurementId || consent !== "granted") return;
    const signals = privacySignals();
    if (!shouldLoadGoogleAnalytics({ measurementId, consent, ...signals })) return;

    enableGoogleAnalytics(measurementId);
    queueGtag("event", "page_view", {
      page_path: pathname,
      page_location: `${window.location.origin}${pathname}`,
      page_title: document.title,
    });
  }, [consent, measurementId, pathname]);

  function choose(nextConsent: GoogleAnalyticsConsent) {
    storageSet(ANALYTICS_CONSENT_KEY, nextConsent);
    setConsent(nextConsent);
    setSettingsOpen(false);
    window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_CHANGED_EVENT, { detail: nextConsent }));
  }

  if (!measurementId || consent === undefined || (consent !== null && !settingsOpen)) return null;

  return (
    <Alert className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 shadow-xl">
      {globalPrivacyControl ? <ShieldCheckIcon aria-hidden /> : <BarChart3Icon aria-hidden />}
      <AlertTitle>{text.title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>{globalPrivacyControl ? text.privacySignal : text.description}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => choose("denied")}>
            {text.reject}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => choose("granted")}
            disabled={globalPrivacyControl}
          >
            {text.allow}
          </Button>
          <Button
            render={<Link href={localizedPath("/privacy", locale)} />}
            nativeButton={false}
            variant="link"
            size="sm"
          >
            {text.privacy}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function GoogleAnalyticsSettingsButton({ locale }: { locale: Locale }) {
  const label = locale === "ar" ? "إعدادات الإحصائيات" : "Analytics settings";
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      className="h-auto w-fit p-0 font-normal text-muted-foreground"
      onClick={() => window.dispatchEvent(new Event(ANALYTICS_SETTINGS_EVENT))}
    >
      {label}
    </Button>
  );
}
