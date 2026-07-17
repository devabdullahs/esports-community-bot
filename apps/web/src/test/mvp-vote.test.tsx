import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@bot/db/mvpVotes.js", () => {
  class MvpVoteError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { castMvpVote: vi.fn(), MvpVoteError };
});
vi.mock("@/lib/community", () => ({
  clientIp: vi.fn(() => "test-ip"),
  requireVerifiedMember: vi.fn(),
  sameOriginOr403: vi.fn(() => null),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOr429: vi.fn(async () => null) }));

import { POST } from "@/app/api/mvp/vote/route";
import { MvpVote } from "@/components/mvp/mvp-vote";
import { castMvpVote, MvpVoteError } from "@bot/db/mvpVotes.js";
import { clientIp, requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import { rateLimitOr429 } from "@/lib/rate-limit";

const member = { discordUserId: "400000000000000005", isVerified: true };
const vote = {
  id: 9,
  voteDate: "2026-07-16",
  opensAt: 1,
  closesAt: 2_000_000_000,
  closed: false,
  revealCounts: true,
  selectedNomineeId: 31,
  nominees: [{ id: 31, playerId: 4, displayName: "Ace", teamName: "Alpha", game: "valorant", imageUrl: null, voteCount: 1 }],
};
const labels = { vote: "Vote", changeVote: "Change vote", selected: "Your vote", votes: "votes", hidden: "Hidden", signIn: "Sign in", signInHint: "Sign in with Discord to vote.", verificationHint: "Verification required.", emptyTitle: "No nominees", emptyDescription: "None today.", failed: "Failed" };

function request(body: unknown) {
  return new Request("http://localhost/api/mvp/vote", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clientIp).mockReturnValue("test-ip");
  vi.mocked(sameOriginOr403).mockReturnValue(null);
  vi.mocked(requireVerifiedMember).mockResolvedValue({ member } as never);
  vi.mocked(rateLimitOr429).mockResolvedValue(null);
  vi.mocked(castMvpVote).mockResolvedValue(vote as never);
});

describe("MVP vote API", () => {
  test("rejects cross-origin and unauthenticated requests before writing", async () => {
    vi.mocked(sameOriginOr403).mockReturnValueOnce(new Response(null, { status: 403 }) as never);
    expect((await POST(request({ sessionId: 9, nomineeId: 31 }))).status).toBe(403);
    expect(requireVerifiedMember).not.toHaveBeenCalled();

    vi.mocked(requireVerifiedMember).mockResolvedValueOnce({ response: new Response(null, { status: 401 }) } as never);
    expect((await POST(request({ sessionId: 9, nomineeId: 31 }))).status).toBe(401);
    expect(castMvpVote).not.toHaveBeenCalled();
  });

  test.each([
    {},
    { sessionId: 9, nomineeId: 0 },
    { sessionId: "9", nomineeId: 31 },
    { sessionId: 9, nomineeId: 31, discordUserId: "attacker" },
  ])("rejects malformed or cross-user body %o", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(castMvpVote).not.toHaveBeenCalled();
  });

  test("uses verified identity and both rate-limit buckets", async () => {
    const response = await POST(request({ sessionId: 9, nomineeId: 31 }));
    expect(response.status).toBe(200);
    expect(castMvpVote).toHaveBeenCalledWith({ sessionId: 9, nomineeId: 31, discordUserId: member.discordUserId });
    expect(rateLimitOr429).toHaveBeenCalledWith({ key: `mvp-vote:${member.discordUserId}`, limit: 15, windowSec: 60 });
    expect(rateLimitOr429).toHaveBeenCalledWith({ key: "mvp-vote-ip:test-ip", limit: 60, windowSec: 60 });
  });

  test("maps a closed session to conflict without leaking internals", async () => {
    vi.mocked(castMvpVote).mockRejectedValueOnce(new MvpVoteError("closed", "Voting is closed."));
    const response = await POST(request({ sessionId: 9, nomineeId: 31 }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Voting is closed." });
  });
});

describe("MVP vote UI", () => {
  test("shows a localized login callback for anonymous visitors", () => {
    const html = renderToStaticMarkup(
      <MvpVote initialVote={{ ...vote, revealCounts: false, selectedNomineeId: null, nominees: [{ ...vote.nominees[0], voteCount: null }] }} locale="ar" canVote={false} signedIn={false} labels={labels} />,
    );
    expect(html).toContain('href="/ar/login?callbackURL=%2Far%2Fmvp"');
    expect(html).not.toContain("1 votes");
  });

  test("renders selected state and disclosed totals after voting", () => {
    const html = renderToStaticMarkup(<MvpVote initialVote={vote} locale="en" canVote signedIn labels={labels} />);
    expect(html).toContain("Your vote");
    expect(html).toContain("1 votes");
  });
});
