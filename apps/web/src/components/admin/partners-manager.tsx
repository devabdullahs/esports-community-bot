"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Edit3Icon, ExternalLinkIcon, HandshakeIcon, PlusIcon, RefreshCwIcon, SaveIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  PARTNER_CAMPAIGN_KINDS,
  PARTNER_CAMPAIGN_STATUSES,
  PARTNER_INQUIRY_STATUSES,
  PARTNER_PAYMENT_METHODS,
  PARTNER_PAYMENT_STATUSES,
  PARTNER_STATUSES,
  type PartnerCampaignKind,
  type PartnerCampaignStatus,
  type PartnerInquiryStatus,
  type PartnerPaymentMethod,
  type PartnerPaymentStatus,
  type PartnerStatus,
} from "@/lib/partner-validation";

type PartnerInquiry = {
  id: number;
  organizationName: string;
  contactName: string;
  email: string;
  websiteUrl: string | null;
  interest: string;
  message: string;
  status: PartnerInquiryStatus;
  createdAt: string;
};

type Partner = {
  id: number;
  slug: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  summary: string;
  status: PartnerStatus;
};

type PartnerCampaign = {
  id: number;
  partnerId: number;
  kind: PartnerCampaignKind;
  target: string;
  title: string;
  note: string;
  startAt: number | null;
  endAt: number | null;
  status: PartnerCampaignStatus;
  paymentMethod: PartnerPaymentMethod;
  paymentStatus: PartnerPaymentStatus;
  paymentReference: string | null;
  partner: Partner | null;
};

const COPY = {
  en: {
    couldNotSave: "Could not save",
    networkError: "Network error. Try again.",
    githubSponsors: "GitHub Sponsors",
    openSponsors: "Open Sponsors profile",
    partners: "Partners",
    addPartner: "Add partner",
    savePartner: "Save partner",
    editingPartner: "Editing partner",
    cancelEdit: "Cancel edit",
    partnerName: "Partner name",
    slug: "Slug",
    logoUrl: "Logo URL",
    websiteUrl: "Website URL",
    summary: "Summary",
    status: "Status",
    campaigns: "Campaigns",
    addCampaign: "Add campaign",
    saveCampaign: "Save campaign",
    partner: "Partner",
    placement: "Placement",
    target: "Target",
    targetHelp: "Optional. Use season:2026 or tournament:123 for page-specific campaigns.",
    title: "Title",
    note: "Note",
    startDate: "Start date",
    endDate: "End date",
    paymentMethod: "Payment method",
    paymentStatus: "Payment status",
    paymentReference: "Payment reference",
    inquiries: "Inquiries",
    noInquiries: "No partner inquiries yet.",
    noPartners: "No partners yet.",
    noCampaigns: "No campaigns yet.",
    edit: "Edit",
    labels: {
      active: "Active",
      inactive: "Inactive",
      draft: "Draft",
      paused: "Paused",
      ended: "Ended",
      unpaid: "Unpaid",
      pending: "Pending",
      paid: "Paid",
      homepage: "Homepage",
      footer: "Footer",
      predictions: "Predictions",
      leaderboard: "Leaderboard",
      tournament: "Tournament",
      github_sponsors: "GitHub Sponsors",
      bank_transfer: "Bank transfer",
      paypal: "PayPal",
      other: "Other",
      waived: "Waived",
      new: "New",
      contacted: "Contacted",
      approved: "Approved",
      declined: "Declined",
      converted: "Converted",
    },
  },
  ar: {
    couldNotSave: "تعذر الحفظ",
    networkError: "حدث خطأ في الاتصال. حاول مرة أخرى.",
    githubSponsors: "GitHub Sponsors",
    openSponsors: "افتح صفحة Sponsors",
    partners: "الشركاء",
    addPartner: "إضافة شريك",
    savePartner: "حفظ الشريك",
    editingPartner: "تعديل الشريك",
    cancelEdit: "إلغاء التعديل",
    partnerName: "اسم الشريك",
    slug: "المعرف",
    logoUrl: "رابط الشعار",
    websiteUrl: "رابط الموقع",
    summary: "الملخص",
    status: "الحالة",
    campaigns: "الحملات",
    addCampaign: "إضافة حملة",
    saveCampaign: "حفظ الحملة",
    partner: "الشريك",
    placement: "الموضع",
    target: "الهدف",
    targetHelp: "اختياري. استخدم season:2026 أو tournament:123 للحملات الخاصة بصفحة معينة.",
    title: "العنوان",
    note: "ملاحظة",
    startDate: "تاريخ البداية",
    endDate: "تاريخ النهاية",
    paymentMethod: "طريقة الدفع",
    paymentStatus: "حالة الدفع",
    paymentReference: "مرجع الدفع",
    inquiries: "طلبات الشراكة",
    noInquiries: "لا توجد طلبات شراكة بعد.",
    noPartners: "لا يوجد شركاء بعد.",
    noCampaigns: "لا توجد حملات بعد.",
    edit: "تعديل",
    labels: {
      active: "نشط",
      inactive: "غير نشط",
      draft: "مسودة",
      paused: "متوقفة",
      ended: "منتهية",
      unpaid: "غير مدفوع",
      pending: "قيد الانتظار",
      paid: "مدفوع",
      homepage: "الرئيسية",
      footer: "التذييل",
      predictions: "التوقعات",
      leaderboard: "لوحة الصدارة",
      tournament: "البطولة",
      github_sponsors: "GitHub Sponsors",
      bank_transfer: "تحويل بنكي",
      paypal: "PayPal",
      other: "أخرى",
      waived: "معفى",
      new: "جديد",
      contacted: "تم التواصل",
      approved: "مقبول",
      declined: "مرفوض",
      converted: "تم التحويل",
    },
  },
} as const;

function emptyPartnerForm() {
  return { slug: "", name: "", logoUrl: "", websiteUrl: "", summary: "", status: "active" as PartnerStatus };
}

function emptyCampaignForm(partnerId = 0) {
  return {
    partnerId,
    kind: "homepage" as PartnerCampaignKind,
    target: "",
    title: "",
    note: "",
    startAt: "",
    endAt: "",
    status: "draft" as PartnerCampaignStatus,
    paymentMethod: "github_sponsors" as PartnerPaymentMethod,
    paymentStatus: "unpaid" as PartnerPaymentStatus,
    paymentReference: "",
  };
}

function dateInput(seconds: number | null): string {
  if (!seconds) return "";
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

async function requestJson(path: string, method: string, body: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export function PartnersManager({
  partners: initialPartners,
  campaigns: initialCampaigns,
  inquiries: initialInquiries,
  githubSponsorsUrl,
  locale,
}: {
  partners: Partner[];
  campaigns: PartnerCampaign[];
  inquiries: PartnerInquiry[];
  githubSponsorsUrl: string;
  locale: Locale;
}) {
  const router = useRouter();
  const t = COPY[locale];
  const [partners, setPartners] = useState(initialPartners);
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [inquiries, setInquiries] = useState(initialInquiries);
  const [partnerForm, setPartnerForm] = useState(emptyPartnerForm());
  const [campaignForm, setCampaignForm] = useState(emptyCampaignForm(initialPartners[0]?.id ?? 0));
  const [editingPartnerId, setEditingPartnerId] = useState<number | null>(null);
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setError(null);
    const data = await fetch("/api/admin/partners").then((res) => res.json());
    setPartners(data.partners ?? []);
    setCampaigns(data.campaigns ?? []);
    setInquiries(data.inquiries ?? []);
    router.refresh();
  }

  async function savePartner(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...partnerForm };
      const saved = await requestJson(
        editingPartnerId ? `/api/admin/partners/${editingPartnerId}` : "/api/admin/partners",
        editingPartnerId ? "PATCH" : "POST",
        body,
      ) as Partner;
      setPartners((prev) => {
        const without = prev.filter((p) => p.id !== saved.id);
        return [...without, saved].sort((a, b) => a.name.localeCompare(b.name));
      });
      setPartnerForm(emptyPartnerForm());
      setEditingPartnerId(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message || t.networkError);
    } finally {
      setBusy(false);
    }
  }

  function editPartner(partner: Partner) {
    setEditingPartnerId(partner.id);
    setPartnerForm({
      slug: partner.slug,
      name: partner.name,
      logoUrl: partner.logoUrl ?? "",
      websiteUrl: partner.websiteUrl ?? "",
      summary: partner.summary,
      status: partner.status,
    });
  }

  async function togglePartner(partner: Partner) {
    setBusy(true);
    setError(null);
    try {
      const saved = await requestJson(`/api/admin/partners/${partner.id}`, "PATCH", {
        slug: partner.slug,
        name: partner.name,
        logoUrl: partner.logoUrl ?? "",
        websiteUrl: partner.websiteUrl ?? "",
        summary: partner.summary,
        status: partner.status === "active" ? "inactive" : "active",
      }) as Partner;
      setPartners((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      router.refresh();
    } catch (err) {
      setError((err as Error).message || t.networkError);
    } finally {
      setBusy(false);
    }
  }

  async function saveCampaign(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await requestJson(
        editingCampaignId ? `/api/admin/partners/campaigns/${editingCampaignId}` : "/api/admin/partners/campaigns",
        editingCampaignId ? "PATCH" : "POST",
        campaignForm,
      ) as PartnerCampaign;
      setCampaigns((prev) => {
        const without = prev.filter((c) => c.id !== saved.id);
        return [saved, ...without];
      });
      setCampaignForm(emptyCampaignForm(partners[0]?.id ?? 0));
      setEditingCampaignId(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message || t.networkError);
    } finally {
      setBusy(false);
    }
  }

  function editCampaign(campaign: PartnerCampaign) {
    setEditingCampaignId(campaign.id);
    setCampaignForm({
      partnerId: campaign.partnerId,
      kind: campaign.kind,
      target: campaign.target,
      title: campaign.title,
      note: campaign.note,
      startAt: dateInput(campaign.startAt),
      endAt: dateInput(campaign.endAt),
      status: campaign.status,
      paymentMethod: campaign.paymentMethod,
      paymentStatus: campaign.paymentStatus,
      paymentReference: campaign.paymentReference ?? "",
    });
  }

  async function updateInquiryStatus(id: number, status: PartnerInquiryStatus) {
    setError(null);
    try {
      const updated = await requestJson(`/api/admin/partners/inquiries/${id}`, "PATCH", { status }) as PartnerInquiry;
      setInquiries((prev) => prev.map((item) => (item.id === id ? updated : item)));
    } catch (err) {
      setError((err as Error).message || t.networkError);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/50 p-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t.githubSponsors}</p>
          <a
            href={githubSponsorsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-sm text-muted-foreground hover:text-foreground"
          >
            {githubSponsorsUrl}
          </a>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button render={<a href={githubSponsorsUrl} target="_blank" rel="noopener noreferrer" />} nativeButton={false} variant="outline" size="sm">
            {t.openSponsors}
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => void reload()}>
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.couldNotSave}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{editingPartnerId ? t.editingPartner : t.addPartner}</CardTitle>
            <CardDescription>{t.githubSponsors}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={savePartner}>
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="partner-name">{t.partnerName}</FieldLabel>
                    <Input id="partner-name" value={partnerForm.name} onChange={(e) => setPartnerForm((p) => ({ ...p, name: e.target.value }))} required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="partner-slug">{t.slug}</FieldLabel>
                    <Input id="partner-slug" value={partnerForm.slug} onChange={(e) => setPartnerForm((p) => ({ ...p, slug: e.target.value }))} required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="partner-logo">{t.logoUrl}</FieldLabel>
                    <Input id="partner-logo" value={partnerForm.logoUrl} onChange={(e) => setPartnerForm((p) => ({ ...p, logoUrl: e.target.value }))} placeholder="https://..." />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="partner-site">{t.websiteUrl}</FieldLabel>
                    <Input id="partner-site" value={partnerForm.websiteUrl} onChange={(e) => setPartnerForm((p) => ({ ...p, websiteUrl: e.target.value }))} placeholder="https://..." />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="partner-summary">{t.summary}</FieldLabel>
                  <Textarea id="partner-summary" value={partnerForm.summary} onChange={(e) => setPartnerForm((p) => ({ ...p, summary: e.target.value }))} rows={3} />
                </Field>
                <Field>
                  <FieldLabel>{t.status}</FieldLabel>
                  <Select value={partnerForm.status} onValueChange={(value) => setPartnerForm((p) => ({ ...p, status: value as PartnerStatus }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{(v) => (v ? t.labels[v as keyof typeof t.labels] : "")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {PARTNER_STATUSES.map((item) => (
                          <SelectItem key={item} value={item}>{t.labels[item]}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={busy}>
                    {editingPartnerId ? <SaveIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
                    {editingPartnerId ? t.savePartner : t.addPartner}
                  </Button>
                  {editingPartnerId ? (
                    <Button type="button" variant="outline" disabled={busy} onClick={() => { setEditingPartnerId(null); setPartnerForm(emptyPartnerForm()); }}>
                      {t.cancelEdit}
                    </Button>
                  ) : null}
                </div>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.partners}</CardTitle>
            <CardDescription>{partners.length ? `${partners.length}` : t.noPartners}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {partners.length ? partners.map((partner) => (
              <div key={partner.id} className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <HandshakeIcon />
                    <span className="font-semibold" dir="auto">{partner.name}</span>
                    <Badge variant={partner.status === "active" ? "default" : "secondary"}>{t.labels[partner.status]}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground" dir="auto">{partner.summary || partner.slug}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => editPartner(partner)}>
                    <Edit3Icon data-icon="inline-start" />
                    {t.edit}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void togglePartner(partner)}>
                    {partner.status === "active" ? t.labels.inactive : t.labels.active}
                  </Button>
                </div>
              </div>
            )) : <p className="text-sm text-muted-foreground">{t.noPartners}</p>}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{editingCampaignId ? t.saveCampaign : t.addCampaign}</CardTitle>
            <CardDescription>{t.targetHelp}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveCampaign}>
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel>{t.partner}</FieldLabel>
                    <Select value={String(campaignForm.partnerId || "")} onValueChange={(value) => setCampaignForm((p) => ({ ...p, partnerId: Number(value) }))}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t.partner}>
                          {(v) => partners.find((p) => String(p.id) === v)?.name ?? t.partner}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {partners.map((partner) => (
                            <SelectItem key={partner.id} value={String(partner.id)}>{partner.name}</SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>{t.placement}</FieldLabel>
                    <Select value={campaignForm.kind} onValueChange={(value) => setCampaignForm((p) => ({ ...p, kind: value as PartnerCampaignKind }))}>
                      <SelectTrigger className="w-full">
                        <SelectValue>{(v) => (v ? t.labels[v as keyof typeof t.labels] : "")}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {PARTNER_CAMPAIGN_KINDS.map((item) => (
                            <SelectItem key={item} value={item}>{t.labels[item]}</SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="campaign-target">{t.target}</FieldLabel>
                    <Input id="campaign-target" value={campaignForm.target} onChange={(e) => setCampaignForm((p) => ({ ...p, target: e.target.value }))} placeholder="season:2026" />
                    <FieldDescription>{t.targetHelp}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>{t.status}</FieldLabel>
                    <Select value={campaignForm.status} onValueChange={(value) => setCampaignForm((p) => ({ ...p, status: value as PartnerCampaignStatus }))}>
                      <SelectTrigger className="w-full">
                        <SelectValue>{(v) => (v ? t.labels[v as keyof typeof t.labels] : "")}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {PARTNER_CAMPAIGN_STATUSES.map((item) => (
                            <SelectItem key={item} value={item}>{t.labels[item]}</SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="campaign-title">{t.title}</FieldLabel>
                    <Input id="campaign-title" value={campaignForm.title} onChange={(e) => setCampaignForm((p) => ({ ...p, title: e.target.value }))} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="campaign-note">{t.note}</FieldLabel>
                    <Input id="campaign-note" value={campaignForm.note} onChange={(e) => setCampaignForm((p) => ({ ...p, note: e.target.value }))} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="campaign-start">{t.startDate}</FieldLabel>
                    <Input id="campaign-start" type="date" value={campaignForm.startAt} onChange={(e) => setCampaignForm((p) => ({ ...p, startAt: e.target.value }))} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="campaign-end">{t.endDate}</FieldLabel>
                    <Input id="campaign-end" type="date" value={campaignForm.endAt} onChange={(e) => setCampaignForm((p) => ({ ...p, endAt: e.target.value }))} />
                  </Field>
                  <Field>
                    <FieldLabel>{t.paymentMethod}</FieldLabel>
                    <Select value={campaignForm.paymentMethod} onValueChange={(value) => setCampaignForm((p) => ({ ...p, paymentMethod: value as PartnerPaymentMethod }))}>
                      <SelectTrigger className="w-full">
                        <SelectValue>{(v) => (v ? t.labels[v as keyof typeof t.labels] : "")}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {PARTNER_PAYMENT_METHODS.map((item) => (
                            <SelectItem key={item} value={item}>{t.labels[item]}</SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>{t.paymentStatus}</FieldLabel>
                    <Select value={campaignForm.paymentStatus} onValueChange={(value) => setCampaignForm((p) => ({ ...p, paymentStatus: value as PartnerPaymentStatus }))}>
                      <SelectTrigger className="w-full">
                        <SelectValue>{(v) => (v ? t.labels[v as keyof typeof t.labels] : "")}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {PARTNER_PAYMENT_STATUSES.map((item) => (
                            <SelectItem key={item} value={item}>{t.labels[item]}</SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="campaign-payment-reference">{t.paymentReference}</FieldLabel>
                  <Input id="campaign-payment-reference" value={campaignForm.paymentReference} onChange={(e) => setCampaignForm((p) => ({ ...p, paymentReference: e.target.value }))} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={busy || !partners.length}>
                    {editingCampaignId ? <SaveIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
                    {editingCampaignId ? t.saveCampaign : t.addCampaign}
                  </Button>
                  {editingCampaignId ? (
                    <Button type="button" variant="outline" disabled={busy} onClick={() => { setEditingCampaignId(null); setCampaignForm(emptyCampaignForm(partners[0]?.id ?? 0)); }}>
                      {t.cancelEdit}
                    </Button>
                  ) : null}
                </div>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.campaigns}</CardTitle>
            <CardDescription>{campaigns.length ? `${campaigns.length}` : t.noCampaigns}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {campaigns.length ? campaigns.map((campaign) => (
              <div key={campaign.id} className="flex flex-col gap-2 rounded-xl border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{campaign.partner?.name ?? `#${campaign.partnerId}`}</span>
                  <Badge variant="outline">{t.labels[campaign.kind]}</Badge>
                  <Badge variant={campaign.status === "active" ? "default" : "secondary"}>{t.labels[campaign.status]}</Badge>
                  <Badge variant={campaign.paymentStatus === "paid" || campaign.paymentMethod === "waived" ? "default" : "outline"}>
                    {campaign.paymentMethod === "waived" ? t.labels.waived : t.labels[campaign.paymentStatus]}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {campaign.target || "global"} {campaign.title ? `- ${campaign.title}` : ""}
                </p>
                <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => editCampaign(campaign)}>
                  <Edit3Icon data-icon="inline-start" />
                  {t.edit}
                </Button>
              </div>
            )) : <p className="text-sm text-muted-foreground">{t.noCampaigns}</p>}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t.inquiries}</CardTitle>
          <CardDescription>{inquiries.length ? `${inquiries.length}` : t.noInquiries}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {inquiries.length ? inquiries.map((inquiry) => (
            <div key={inquiry.id} className="grid gap-3 rounded-xl border bg-muted/20 p-3 lg:grid-cols-[minmax(0,1fr)_14rem]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold" dir="auto">{inquiry.organizationName}</span>
                  <Badge variant="outline">{inquiry.interest}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {inquiry.contactName} - <a href={`mailto:${inquiry.email}`} className="hover:text-foreground">{inquiry.email}</a>
                </p>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground" dir="auto">{inquiry.message}</p>
              </div>
              <Field>
                <FieldLabel>{t.status}</FieldLabel>
                <Select value={inquiry.status} onValueChange={(value) => void updateInquiryStatus(inquiry.id, value as PartnerInquiryStatus)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v) => (v ? t.labels[v as keyof typeof t.labels] : "")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {PARTNER_INQUIRY_STATUSES.map((item) => (
                        <SelectItem key={item} value={item}>{t.labels[item]}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )) : <p className="text-sm text-muted-foreground">{t.noInquiries}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
