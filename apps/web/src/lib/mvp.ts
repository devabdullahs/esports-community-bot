import "server-only";

import {
  getCurrentMvpVote,
  getLatestClosedMvpResult,
  getLatestMvpWinForPlayer,
} from "@bot/db/mvpVotes.js";

export type MvpNominee = {
  id: number;
  playerId: number | null;
  displayName: string;
  teamName: string | null;
  game: string;
  imageUrl: string | null;
  voteCount: number | null;
};

export type MvpVoteView = {
  id: number;
  voteDate: string;
  opensAt: number;
  closesAt: number;
  closed: boolean;
  revealCounts: boolean;
  selectedNomineeId: number | null;
  nominees: MvpNominee[];
};

export async function getMvpVoteView(discordUserId?: string | null) {
  return getCurrentMvpVote({ discordUserId: discordUserId || null }) as Promise<MvpVoteView>;
}

export async function getLatestMvpResult() {
  return getLatestClosedMvpResult() as Promise<{
    voteDate: string;
    closesAt: number;
    winner: MvpNominee;
  } | null>;
}

export async function getPlayerMvpWin(playerId: number) {
  return getLatestMvpWinForPlayer(playerId) as Promise<{ voteDate: string; voteCount: number } | null>;
}

