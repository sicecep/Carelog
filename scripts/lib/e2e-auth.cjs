// Shared E2E auth helpers (scripts/lib/e2e-auth.cjs).
//
// The fast path: with AUTH_DEV_EXPOSE_LINK=true on the dev API (config
// validation refuses it outside development), POST /auth/magic-link returns
// the raw verification link as dev_verify_url and never sends an email —
// sign-in costs one HTTP round trip and zero Resend quota.
//
// The fallback: against a server WITHOUT the flag (prod-like), we mint the
// token ourselves via psql — only the SHA-256 hash is stored, so we insert
// our own hash and visit the raw token. Requires docker exec pg access.
//
// Usage:
//   const { sql, signIn } = require("./lib/e2e-auth");
//   const { ctx, page } = await signIn(browser, `user${Date.now()}@carelog.test`);

const { execFileSync } = require("child_process");
const crypto = require("crypto");

const API = process.env.E2E_API || "http://localhost:8080";

function sql(q) {
  return execFileSync(
    "docker",
    ["exec", "pg", "psql", "-U", "dev", "-d", "carelog", "-t", "-A", "-F", "\t", "-c", q],
    { encoding: "utf8" }
  ).trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
}

async function requestMagicLink(email) {
  const res = await fetch(`${API}/api/v1/auth/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`magic-link ${res.status}`);
  return res.json();
}

// mintVerifyURL creates a verification URL by inserting our own token hash
// (only hashes are stored). Fallback for servers without the dev flag.
function mintVerifyURL(email) {
  const raw = crypto.randomBytes(32);
  const hashHex = crypto.createHash("sha256").update(raw).digest("hex");
  const rows = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${email}')`);
  if (!rows.length) throw new Error(`no user row for ${email}`);
  sql(
    `INSERT INTO auth_magic_links (user_id, token_hash, expires_at, created_at)
     VALUES ('${rows[0][0]}', decode('${hashHex}','hex'), now() + interval '15 minutes', now())`
  );
  return `${API}/api/v1/auth/verify?token=${raw.toString("base64url")}`;
}

// getVerifyURL returns a fresh, unconsumed verification URL — dev link when
// available, minted token otherwise. Each URL is single-use.
async function getVerifyURL(email) {
  const body = await requestMagicLink(email);
  return body.dev_verify_url || mintVerifyURL(email);
}

// signIn signs a user into a fresh browser context (mobile viewport by
// default). The approval gate pends new self-registered users; approve=true
// flips the row via SQL and verifies a SECOND link — one login is not enough,
// the first lands on /pending with no cookies. Pass approve=false to test
// the pending state deliberately (e2e-approval-flow).
async function signIn(browser, email, { approve = true, viewport } = {}) {
  const ctx = await browser.newContext({
    viewport: viewport || { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  await page.goto(await getVerifyURL(email), { waitUntil: "domcontentloaded" });
  if (approve) {
    sql(
      `UPDATE users SET approval_status='approved', approved_at=now(), approved_by=id
       WHERE LOWER(email)=LOWER('${email}')`
    );
    await page.goto(await getVerifyURL(email), { waitUntil: "domcontentloaded" });
  }
  return { ctx, page };
}

module.exports = { sql, requestMagicLink, mintVerifyURL, getVerifyURL, signIn };
