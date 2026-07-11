import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Point the DB at a per-run temp file BEFORE any DB imports happen.
const tmpDb = path.join(os.tmpdir(), `esports-test-${crypto.randomBytes(6).toString("hex")}.sqlite`);
process.env.DB_PATH = tmpDb;
process.env.LOG_LEVEL = "error";
// Production is behind Cloudflare/CranL. Tests that exercise direct mode
// override this explicitly; the shared default must stay deny-by-default.
process.env.EWC_TRUSTED_PROXY = "cloudflare";
