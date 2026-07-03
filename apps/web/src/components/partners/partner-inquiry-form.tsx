"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2Icon, SendIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Locale } from "@/lib/i18n";
import { PARTNER_INTERESTS, type PartnerInterest } from "@/lib/partner-validation";

const COPY = {
  en: {
    org: "Organization",
    orgPlaceholder: "Company, team, creator group...",
    contact: "Contact name",
    email: "Email",
    website: "Website",
    websiteHint: "Optional public website or social profile.",
    interest: "Interest",
    message: "What would you like to support?",
    messagePlaceholder: "Tell us about your brand, the kind of recognition you want, and whether GitHub Sponsors works for you.",
    submit: "Send inquiry",
    sending: "Sending...",
    successTitle: "Inquiry sent",
    successDescription: "Thanks. We will review it manually and follow up with the cleanest payment option.",
    errorTitle: "Could not send inquiry",
    networkError: "Network error. Try again.",
    interests: {
      open_source_partner: "Open-source project partner",
      prediction_partner: "Prediction season partner",
      event_prize_later: "Future event or prize support",
      other: "Other partnership",
    },
  },
  ar: {
    org: "الجهة",
    orgPlaceholder: "شركة، فريق، مجموعة صناع محتوى...",
    contact: "اسم مسؤول التواصل",
    email: "البريد الإلكتروني",
    website: "الموقع",
    websiteHint: "اختياري: موقع عام أو حساب اجتماعي.",
    interest: "نوع الشراكة",
    message: "ما الذي ترغب بدعمه؟",
    messagePlaceholder: "عرّفنا بالجهة ونوع الظهور المطلوب وهل يناسبك الدفع عبر GitHub Sponsors.",
    submit: "إرسال الطلب",
    sending: "جارٍ الإرسال...",
    successTitle: "تم إرسال الطلب",
    successDescription: "شكراً لك. سنراجع الطلب يدوياً ونتواصل معك بخيار الدفع الأنسب.",
    errorTitle: "تعذر إرسال الطلب",
    networkError: "حدث خطأ في الاتصال. حاول مرة أخرى.",
    interests: {
      open_source_partner: "شريك المشروع مفتوح المصدر",
      prediction_partner: "شريك موسم التوقعات",
      event_prize_later: "دعم فعالية أو جوائز لاحقاً",
      other: "شراكة أخرى",
    },
  },
} as const;

export function PartnerInquiryForm({ locale }: { locale: Locale }) {
  const t = COPY[locale];
  const [organizationName, setOrganizationName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [interest, setInterest] = useState<PartnerInterest>("open_source_partner");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/partners/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationName, contactName, email, websiteUrl, interest, message }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || `${t.errorTitle} (${res.status})`);
        return;
      }
      setSent(true);
      setOrganizationName("");
      setContactName("");
      setEmail("");
      setWebsiteUrl("");
      setInterest("open_source_partner");
      setMessage("");
    } catch {
      setError(t.networkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border bg-card/45 p-4 shadow-sm sm:p-5">
      <FieldGroup>
        {sent ? (
          <Alert>
            <CheckCircle2Icon data-icon="inline-start" />
            <AlertTitle>{t.successTitle}</AlertTitle>
            <AlertDescription>{t.successDescription}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t.errorTitle}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="partner-org">{t.org}</FieldLabel>
            <Input
              id="partner-org"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder={t.orgPlaceholder}
              required
              maxLength={160}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="partner-contact">{t.contact}</FieldLabel>
            <Input
              id="partner-contact"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              required
              maxLength={120}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="partner-email">{t.email}</FieldLabel>
            <Input
              id="partner-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="partner-website">{t.website}</FieldLabel>
            <Input
              id="partner-website"
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://example.com"
              maxLength={512}
            />
            <FieldDescription>{t.websiteHint}</FieldDescription>
          </Field>
        </div>
        <Field>
          <FieldLabel>{t.interest}</FieldLabel>
          <Select value={interest} onValueChange={(value) => setInterest(value as PartnerInterest)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PARTNER_INTERESTS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {t.interests[item]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="partner-message">{t.message}</FieldLabel>
          <Textarea
            id="partner-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t.messagePlaceholder}
            required
            maxLength={2000}
            rows={6}
          />
        </Field>
        <Button type="submit" disabled={busy} className="w-fit">
          <SendIcon data-icon="inline-start" />
          {busy ? t.sending : t.submit}
        </Button>
      </FieldGroup>
    </form>
  );
}
