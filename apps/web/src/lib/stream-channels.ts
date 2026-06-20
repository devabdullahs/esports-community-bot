import "server-only";

import {
  createStreamChannel as _create,
  deleteStreamChannel as _delete,
  getStreamChannel as _get,
  listStreamChannels as _list,
  updateStreamChannel as _update,
} from "@bot/db/streamChannels.js";
import type {
  CreateStreamChannelInput,
  StreamChannel,
  StreamScope,
  UpdateStreamChannelInput,
} from "@/lib/stream-types";

// Typed boundary over the untyped bot JS registry module (src/db/streamChannels.js).
export * from "@/lib/stream-types";

const create = _create as unknown as (input: CreateStreamChannelInput) => Promise<StreamChannel>;
const remove = _delete as unknown as (id: number) => Promise<{ deleted: number }>;
const getOne = _get as unknown as (id: number) => Promise<StreamChannel | null>;
const list = _list as unknown as (
  filter?: { scope?: StreamScope | null; gameSlug?: string | null; activeOnly?: boolean },
) => Promise<StreamChannel[]>;
const update = _update as unknown as (id: number, patch: UpdateStreamChannelInput) => Promise<StreamChannel | null>;

export function listStreamChannels(filter?: {
  scope?: StreamScope | null;
  gameSlug?: string | null;
  activeOnly?: boolean;
}): Promise<StreamChannel[]> {
  return list(filter);
}

export function createStreamChannel(input: CreateStreamChannelInput): Promise<StreamChannel> {
  return create(input);
}

export function getStreamChannel(id: number): Promise<StreamChannel | null> {
  return getOne(id);
}

export function updateStreamChannel(id: number, patch: UpdateStreamChannelInput): Promise<StreamChannel | null> {
  return update(id, patch);
}

export function deleteStreamChannel(id: number): Promise<{ deleted: number }> {
  return remove(id);
}
