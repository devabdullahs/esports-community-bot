import { NextResponse } from "next/server";

import { getDeploymentVersion } from "@/lib/deployment-version";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export function GET() {
  return NextResponse.json(
    { version: getDeploymentVersion() },
    { headers: NO_STORE_HEADERS },
  );
}
