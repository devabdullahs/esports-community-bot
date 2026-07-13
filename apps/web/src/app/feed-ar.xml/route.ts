import { newsFeedResponse } from "@/lib/news-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return newsFeedResponse("ar");
}
