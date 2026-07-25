import type { Metadata } from "next";
import Link from "next/link";
import { HomeIcon, RefreshCwIcon, WifiOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { localizedPath } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false, follow: false },
};

const OFFLINE_COPY = {
  en: {
    title: "You are offline",
    body: "The latest esports updates need an internet connection. Reconnect, then try the page again.",
    retry: "Try again",
    home: "Go to dashboard",
  },
  ar: {
    title: "\u0623\u0646\u062a \u063a\u064a\u0631 \u0645\u062a\u0635\u0644",
    body: "\u062a\u062d\u062a\u0627\u062c \u0622\u062e\u0631 \u062a\u062d\u062f\u064a\u062b\u0627\u062a \u0627\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629 \u0625\u0644\u0649 \u0627\u062a\u0635\u0627\u0644 \u0628\u0627\u0644\u0625\u0646\u062a\u0631\u0646\u062a. \u0623\u0639\u062f \u0627\u0644\u0627\u062a\u0635\u0627\u0644 \u062b\u0645 \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.",
    retry: "\u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649",
    home: "\u0627\u0644\u0630\u0647\u0627\u0628 \u0625\u0644\u0649 \u0644\u0648\u062d\u0629 \u0627\u0644\u0645\u062c\u062a\u0645\u0639",
  },
} as const;

export default async function OfflinePage() {
  const locale = await getRequestLocale();
  const text = OFFLINE_COPY[locale];

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 items-center px-5 py-16">
      <Card className="w-full">
        <CardHeader>
          <span className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <WifiOffIcon className="size-5" />
          </span>
          <CardTitle>{text.title}</CardTitle>
          <CardDescription>{text.body}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            render={<a href={localizedPath("/", locale)} />}
            nativeButton={false}
          >
            <RefreshCwIcon data-icon="inline-start" />
            {text.retry}
          </Button>
          <Button
            render={<Link href={localizedPath("/", locale)} />}
            nativeButton={false}
            variant="outline"
          >
            <HomeIcon data-icon="inline-start" />
            {text.home}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
