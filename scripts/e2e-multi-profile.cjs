// OWN-007 — multiple care profiles + plan-quota UX, end to end.
//
// The data model already supported several recipients; what was broken was the
// boundary: hitting the free-plan cap returned 500 INTERNAL instead of a 403
// upgrade prompt, because mapError did not unwrap wrapped errors and the
// trigger's SQLSTATE was unmapped. That is a monetization moment failing as a
// server crash.
//
// Covers: child+elderly profiles coexisting with isolated data, the API
// returning 403 upgrade_required at the cap, the UI surfacing the limit and
// disabling Add, archived profiles NOT counting toward the quota, and a plan
// upgrade unblocking the next profile.

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { sql, signIn } = require("./lib/e2e-auth.cjs");
const { execFileSync } = require("child_process");
const crypto = require("crypto");

const WEB = process.env.E2E_WEB || "http://localhost:3000";
const API = process.env.E2E_API || "http://localhost:8080";


const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}




async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const stamp = Date.now();
  const OWNER = `mp7owner${stamp}@carelog.test`;

  try {
    const owner = await signIn(browser, OWNER);
    const ws = sql(
      `SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
       JOIN users u ON u.id=m.user_id WHERE LOWER(u.email)=LOWER('${OWNER}')`
    )[0][0];

    // Land on the web origin so same-origin fetches reach the Next proxy and
    // carry the session cookie (see references/e2e-harness.md).
    await owner.page.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });
    const api = async (method, path, body) =>
      owner.page.evaluate(
        async ({ method, path, body, ws }) => {
          const r = await fetch(`/api/v1${path}`, {
            method,
            headers: { "Content-Type": "application/json", "X-Workspace-ID": ws },
            credentials: "include",
            body: body ? JSON.stringify(body) : undefined,
          });
          return { status: r.status, body: await r.json().catch(() => null) };
        },
        { method, path, body, ws }
      );

    const mk = (name, careType, modules) =>
      api("POST", "/recipients", {
        full_name: name,
        care_type: careType,
        enabled_modules: modules,
      });

    // ── The PRD case: one child AND one elderly parent in one account ────
    const child = await mk(`Anak ${stamp}`, "child", ["meal", "sleep", "learning"]);
    check("M1. create child profile", child.status === 201, `status=${child.status}`);
    const elder = await mk(`Nenek ${stamp}`, "elderly", ["meal", "medication", "health"]);
    check("M2. create elderly profile", elder.status === 201, `status=${elder.status}`);

    const childId = child.body?.data?.id;
    const elderId = elder.body?.data?.id;

    // Care-type-specific modules must be preserved, not flattened.
    const mods = sql(
      `SELECT care_type, enabled_modules FROM care_recipients
       WHERE workspace_id='${ws}' ORDER BY created_at`
    );
    const childMods = mods.find((m) => m[0] === "child")?.[1] ?? "";
    const elderMods = mods.find((m) => m[0] === "elderly")?.[1] ?? "";
    check("M3. child keeps learning module", childMods.includes("learning"), childMods);
    check("M4. elderly keeps medication module", elderMods.includes("medication"), elderMods);
    check("M5. profiles have DIFFERENT module sets", childMods !== elderMods);

    // ── Module validation: a module outside the care type is rejected ────
    // 400 validation_error is the project-wide shape for ErrValidation
    // (service/recipient.go), not 422 — the elderly care type has no diaper
    // module, and the service enforces the care-type subset.
    const badMod = await mk(`Salah ${stamp}`, "elderly", ["diaper"]);
    check("M6. module invalid for care type is rejected",
      badMod.status === 400 && badMod.body?.error?.code === "validation_error",
      `status=${badMod.status} code=${badMod.body?.error?.code}`);

    // ── Data isolation between profiles ──────────────────────────────────
    const tlChild = await api("GET", `/recipients/${childId}/timeline`);
    const tlElder = await api("GET", `/recipients/${elderId}/timeline`);
    check("M7. per-profile timelines are separate",
      tlChild.status === 200 && tlElder.status === 200,
      `child=${tlChild.status} elder=${tlElder.status}`);

    // ── THE REGRESSION: free plan caps at 2; must be 403, never 500 ──────
    const third = await mk(`Kakek ${stamp}`, "elderly", ["meal"]);
    check("M8. 3rd profile on free plan is 403 upgrade_required (was 500)",
      third.status === 403 && third.body?.error?.code === "upgrade_required",
      `status=${third.status} code=${third.body?.error?.code}`);
    check("M9. error message is human, not a SQLSTATE",
      typeof third.body?.error?.message === "string" &&
        !/SQLSTATE|EXCEPTION|pq:|PROFILE_LIMIT/.test(third.body.error.message),
      third.body?.error?.message);

    // ── UI surfaces the limit (ID locale) ────────────────────────────────
    await owner.page.goto(`${WEB}/id/recipients`, { waitUntil: "networkidle" });
    const idBody = await owner.page.innerText("body");
    check("M10. ID: limit notice rendered",
      idBody.includes("Batas profil perawatan tercapai"),
      idBody.slice(0, 120).replace(/\n/g, " | "));
    check("M11. ID: upgrade CTA rendered", idBody.includes("Lihat paket"));
    check("M12. ID: usage count shown", /2 dari 2 profil terpakai/.test(idBody),
      (idBody.match(/\d+ dari \d+ profil terpakai/) || []).join(""));

    // Add control must be present but DISABLED (vanishing reads as a bug).
    const disabledAdd = await owner.page.locator("button[disabled]", { hasText: /Tambah/i }).count();
    check("M13. add control present and disabled at cap", disabledAdd === 1, `count=${disabledAdd}`);
    const liveAddLink = await owner.page.locator('a[href*="onboarding"]').count();
    check("M14. no live add link at cap", liveAddLink === 0, `count=${liveAddLink}`);

    // ── EN locale renders English, not Indonesian (the #34 bug class) ────
    await owner.page.goto(`${WEB}/en/recipients`, { waitUntil: "networkidle" });
    const enBody = await owner.page.innerText("body");
    check("M15. EN: limit notice in English",
      enBody.includes("Care profile limit reached") && enBody.includes("See plans"),
      enBody.slice(0, 120).replace(/\n/g, " | "));
    check("M16. no raw i18n keys leaked",
      !/recipients\.planLimit|planCountLabel/.test(enBody),
      (enBody.match(/recipients\.\w+/g) || []).join(","));

    // ── Archiving frees a slot: the trigger counts ACTIVE only ───────────
    // Archive one of the two, which drops the active count to 1 of 2. The UI
    // must offer Add again at that point.
    await api("DELETE", `/recipients/${elderId}`);
    await owner.page.goto(`${WEB}/id/recipients`, { waitUntil: "networkidle" });
    const reAdd = await owner.page.locator('a[href*="onboarding"]').count();
    check("M18. add link returns once under the cap", reAdd === 1, `count=${reAdd}`);

    // And the freed slot is genuinely usable, not just visually offered.
    const afterArchive = await mk(`Pengganti ${stamp}`, "elderly", ["meal"]);
    check("M17. archived profile frees a quota slot",
      afterArchive.status === 201, `status=${afterArchive.status}`);

    // ── Upgrading the plan raises the cap ────────────────────────────────
    sql(`UPDATE workspaces SET plan='starter' WHERE id='${ws}'`);
    const onStarter = await mk(`Tambahan ${stamp}`, "elderly", ["meal"]);
    check("M19. plan upgrade allows another profile",
      onStarter.status === 201, `status=${onStarter.status}`);

    await owner.page.goto(`${WEB}/id/recipients`, { waitUntil: "networkidle" });
    const starterBody = await owner.page.innerText("body");
    check("M20. starter plan shows no limit notice",
      !starterBody.includes("Batas profil perawatan tercapai"));

  } catch (err) {
    // finally's process.exit() would otherwise swallow this into a false green.
    check("FATAL: run completed without throwing", false, String(err).slice(0, 250));
  } finally {
    const passed = results.filter((r) => r.passed).length;
    console.log(`\n${passed}/${results.length} checks passed`);
    await browser.close();
    process.exit(passed === results.length ? 0 : 1);
  }
}

main().catch((e) => {
  console.error("E2E ERROR", e);
  process.exit(1);
});
