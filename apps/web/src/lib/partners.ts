import "server-only";

import {
  createPartner as _createPartner,
  createPartnerCampaign as _createCampaign,
  createPartnerInquiry as _createInquiry,
  deletePartner as _deletePartner,
  deletePartnerCampaign as _deleteCampaign,
  getPartner as _getPartner,
  getPartnerCampaign as _getCampaign,
  getPartnerInquiry as _getInquiry,
  listActivePartnerCampaigns as _listActiveCampaigns,
  listPartnerCampaigns as _listCampaigns,
  listPartnerInquiries as _listInquiries,
  listPartners as _listPartners,
  updatePartner as _updatePartner,
  updatePartnerCampaign as _updateCampaign,
  updatePartnerInquiryStatus as _updateInquiryStatus,
} from "@bot/db/partners.js";
import type {
  PartnerCampaignInput,
  PartnerCampaignKind,
  PartnerCampaignStatus,
  PartnerInquiryInput,
  PartnerInquiryStatus,
  PartnerInput,
  PartnerPaymentMethod,
  PartnerPaymentStatus,
  PartnerStatus,
} from "@/lib/partner-validation";

export type PartnerInquiry = {
  id: number;
  organizationName: string;
  contactName: string;
  email: string;
  websiteUrl: string | null;
  interest: PartnerInquiryInput["interest"];
  message: string;
  status: PartnerInquiryStatus;
  createdAt: string;
  updatedAt: string;
};

export type Partner = {
  id: number;
  slug: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  summary: string;
  status: PartnerStatus;
  createdAt: string;
  updatedAt: string;
};

export type PartnerCampaign = {
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
  createdAt: string;
  updatedAt: string;
  partner: Partner | null;
};

const createInquiry = _createInquiry as unknown as (input: PartnerInquiryInput) => Promise<PartnerInquiry>;
const listInquiries = _listInquiries as unknown as (filter?: {
  status?: PartnerInquiryStatus | null;
  limit?: number;
  offset?: number;
}) => Promise<PartnerInquiry[]>;
const getInquiry = _getInquiry as unknown as (id: number) => Promise<PartnerInquiry | null>;
const updateInquiryStatus = _updateInquiryStatus as unknown as (
  id: number,
  status: PartnerInquiryStatus,
) => Promise<PartnerInquiry | null>;

const createPartnerRecord = _createPartner as unknown as (input: PartnerInput) => Promise<Partner>;
const listPartnerRecords = _listPartners as unknown as (filter?: { activeOnly?: boolean }) => Promise<Partner[]>;
const getPartnerRecord = _getPartner as unknown as (idOrSlug: number | string) => Promise<Partner | null>;
const updatePartnerRecord = _updatePartner as unknown as (
  id: number,
  patch: Partial<PartnerInput>,
) => Promise<Partner | null>;
const deletePartnerRecord = _deletePartner as unknown as (id: number) => Promise<{ deleted: number }>;

const createCampaignRecord = _createCampaign as unknown as (input: PartnerCampaignInput) => Promise<PartnerCampaign>;
const listCampaignRecords = _listCampaigns as unknown as (filter?: {
  kind?: PartnerCampaignKind | null;
  partnerId?: number | null;
}) => Promise<PartnerCampaign[]>;
const getCampaignRecord = _getCampaign as unknown as (id: number) => Promise<PartnerCampaign | null>;
const listActiveCampaignRecords = _listActiveCampaigns as unknown as (filter: {
  kind: PartnerCampaignKind;
  target?: string;
  now?: number;
  limit?: number;
}) => Promise<PartnerCampaign[]>;
const updateCampaignRecord = _updateCampaign as unknown as (
  id: number,
  patch: Partial<PartnerCampaignInput>,
) => Promise<PartnerCampaign | null>;
const deleteCampaignRecord = _deleteCampaign as unknown as (id: number) => Promise<{ deleted: number }>;

export function githubSponsorsUrl(): string {
  return process.env.NEXT_PUBLIC_GITHUB_SPONSORS_URL || "https://github.com/sponsors/devabdullahs";
}

export function createPartnerInquiry(input: PartnerInquiryInput): Promise<PartnerInquiry> {
  return createInquiry(input);
}

export function listPartnerInquiries(filter?: {
  status?: PartnerInquiryStatus | null;
  limit?: number;
  offset?: number;
}): Promise<PartnerInquiry[]> {
  return listInquiries(filter);
}

export function getPartnerInquiry(id: number): Promise<PartnerInquiry | null> {
  return getInquiry(id);
}

export function updatePartnerInquiryStatus(id: number, status: PartnerInquiryStatus): Promise<PartnerInquiry | null> {
  return updateInquiryStatus(id, status);
}

export function createPartner(input: PartnerInput): Promise<Partner> {
  return createPartnerRecord(input);
}

export function listPartners(filter?: { activeOnly?: boolean }): Promise<Partner[]> {
  return listPartnerRecords(filter);
}

export function getPartner(idOrSlug: number | string): Promise<Partner | null> {
  return getPartnerRecord(idOrSlug);
}

export function updatePartner(id: number, patch: Partial<PartnerInput>): Promise<Partner | null> {
  return updatePartnerRecord(id, patch);
}

export function deletePartner(id: number): Promise<{ deleted: number }> {
  return deletePartnerRecord(id);
}

export function createPartnerCampaign(input: PartnerCampaignInput): Promise<PartnerCampaign> {
  return createCampaignRecord(input);
}

export function listPartnerCampaigns(filter?: {
  kind?: PartnerCampaignKind | null;
  partnerId?: number | null;
}): Promise<PartnerCampaign[]> {
  return listCampaignRecords(filter);
}

export function getPartnerCampaign(id: number): Promise<PartnerCampaign | null> {
  return getCampaignRecord(id);
}

export function listActivePartnerCampaigns(filter: {
  kind: PartnerCampaignKind;
  target?: string;
  now?: number;
  limit?: number;
}): Promise<PartnerCampaign[]> {
  return listActiveCampaignRecords(filter);
}

export function updatePartnerCampaign(id: number, patch: Partial<PartnerCampaignInput>): Promise<PartnerCampaign | null> {
  return updateCampaignRecord(id, patch);
}

export function deletePartnerCampaign(id: number): Promise<{ deleted: number }> {
  return deleteCampaignRecord(id);
}
