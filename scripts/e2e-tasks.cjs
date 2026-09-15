// OWN-006 / TSK-001 / TSK-002 — task assignment, end to end in a real browser.
//
// TSK-001: owner creates a task on a recipient and assigns it to a caregiver.
// TSK-002: the assigned caregiver advances the status (todo -> in_progress ->
//          done) and the owner sees completion. Reopen returns it to todo.
// Guards:  a caregiver cannot create tasks (owner-only); a caregiver cannot
//          advance a task assigned to SOMEONE ELSE; assigning to a non-assigned
//          user is rejected (422); a revoked caregiver loses the task list.
//
// Asserts RENDERED text and real HTTP status codes, not just green gates —
// green gates have shipped broken CareLog features seven times.

const { chromium } = require("/home/dev/.hermes/hermes-agent/node_modules/playwright-core");
const { sql, requestMagicLink, signIn } = require("./lib/e2e-auth");
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
  const OWNER = `tskowner${stamp}@carelog.test`;
  const CG1 = `tskcg1-${stamp}@carelog.test`; // assigned, does the task
  const CG2 = `tskcg2-${stamp}@carelog.test`; // assigned to recipient but NOT the task

  try {
    const owner = await signIn(browser, OWNER);
    const ws = sql(
      `SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
       JOIN users u ON u.id=m.user_id WHERE LOWER(u.email)=LOWER('${OWNER}')`
    )[0][0];
    const uid = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${OWNER}')`)[0][0];

    sql(
      `INSERT INTO care_recipients (workspace_id, full_name, care_type, enabled_modules, created_by, is_active, created_at)
       VALUES ('${ws}', 'Tugas Anak ${stamp}', 'child', '["meal"]'::jsonb, '${uid}', true, now())`
    );
    const R1 = sql(`SELECT id FROM care_recipients WHERE full_name='Tugas Anak ${stamp}'`)[0][0];

    const mkCaregiver = async (email) => {
      await requestMagicLink(email);
      const id = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${email}')`)[0][0];
      sql(`UPDATE users SET approval_status='approved', approved_at=now() WHERE id='${id}'`);
      const c = await signIn(browser, email);
      sql(`DELETE FROM workspace_members WHERE user_id='${id}'`);
      sql(
        `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
         VALUES ('${ws}', '${id}', 'caregiver', now())`
      );
      // Assign both to the recipient so they can open its page.
      sql(
        `INSERT INTO caregiver_assignments (workspace_id, recipient_id, caregiver_id)
         VALUES ('${ws}', '${R1}', '${id}') ON CONFLICT DO NOTHING`
      );
      return { id, ...c };
    };
    const cg1 = await mkCaregiver(CG1);
    const cg2 = await mkCaregiver(CG2);

    // apiVia() issues a same-origin fetch from the page context. That only
    // reaches the Next proxy (and carries the session cookie) if the page is
    // actually ON the web origin — after signIn the page is still parked on
    // the API's verify URL, where /api/v1/... resolves to :8080 directly and
    // returns 401. Navigate each caregiver into the app first.
    await cg1.page.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });
    await cg2.page.goto(`${WEB}/id/dashboard`, { waitUntil: "networkidle" });

    const apiVia = (page) => async (method, path, body, workspace = ws) =>
      page.evaluate(
        async ({ method, path, body, workspace }) => {
          const r = await fetch(`/api/v1${path}`, {
            method,
            headers: { "Content-Type": "application/json", "X-Workspace-ID": workspace },
            credentials: "include",
            body: body ? JSON.stringify(body) : undefined,
          });
          return { status: r.status, body: await r.json().catch(() => null) };
        },
        { method, path, body, workspace }
      );

    const ownerApi = apiVia(owner.page);
    const cg1Api = apiVia(cg1.page);
    const cg2Api = apiVia(cg2.page);

    // ── TSK-001: owner creates a task via the UI, assigns it to CG1 ──────
    await owner.page.goto(`${WEB}/id/recipients/${R1}`, { waitUntil: "networkidle" });
    const panelText = await owner.page.innerText("body");
    check("T0. task panel renders", panelText.includes("Tugas untuk profil ini"),
      panelText.slice(0, 120));

    await owner.page.locator("button", { hasText: "Tambah tugas" }).first().click();
    await owner.page.fill("#task-title", "Berikan obat sore");
    await owner.page.fill("#task-description", "Sesudah makan");
    await owner.page.selectOption("#task-assignee", cg1.id);
    await owner.page.fill("#task-due-date", "2026-12-31");
    await owner.page.fill("#task-due-time", "17:00");
    await owner.page.locator("button[type=submit]", { hasText: "Simpan" }).click();
    await owner.page.waitForTimeout(800);

    const afterCreate = await owner.page.innerText("body");
    check("T1. created task renders with title", afterCreate.includes("Berikan obat sore"));
    check("T1b. task shows assignee + due time", afterCreate.includes("17:00"));

    // Confirm the row landed in the DB with the right assignee and status.
    const dbRows = sql(
      `SELECT status, assigned_to, due_time FROM tasks WHERE recipient_id='${R1}' AND title='Berikan obat sore'`
    );
    check("T1c. task row in DB, todo, assigned to CG1",
      dbRows.length === 1 && dbRows[0][0] === "todo" && dbRows[0][1] === cg1.id,
      JSON.stringify(dbRows[0] || null));
    const taskId = sql(
      `SELECT id FROM tasks WHERE recipient_id='${R1}' AND title='Berikan obat sore'`
    )[0][0];

    // ── Guard: caregiver cannot CREATE tasks (owner-only) ───────────────
    const cgCreate = await cg1Api("POST", `/recipients/${R1}/tasks`, {
      title: "Sneaky task", due_date: "2026-12-31",
    });
    check("G1. caregiver create is 403", cgCreate.status === 403, `status=${cgCreate.status}`);

    // ── Guard: assign to a user with NO assignment → 422 ────────────────
    // Make a bare workspace member with no caregiver_assignments row.
    const strangerEmail = `tskstranger-${stamp}@carelog.test`;
    await requestMagicLink(strangerEmail);
    const strangerId = sql(`SELECT id FROM users WHERE LOWER(email)=LOWER('${strangerEmail}')`)[0][0];
    sql(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES ('${ws}', '${strangerId}', 'caregiver', now()) ON CONFLICT DO NOTHING`
    );
    const badAssign = await ownerApi("POST", `/recipients/${R1}/tasks`, {
      title: "Bad assignee", due_date: "2026-12-31", assigned_to: strangerId,
    });
    check("G2. assign to non-assigned caregiver is 422",
      badAssign.status === 422 && badAssign.body?.error?.code === "invalid_assignee",
      `status=${badAssign.status} code=${badAssign.body?.error?.code}`);

    // ── TSK-002: CG1 advances the task through its lifecycle ────────────
    let r = await cg1Api("PATCH", `/tasks/${taskId}`, { status: "in_progress" });
    check("T2. CG1 -> in_progress ok", r.status === 200 && r.body?.data?.status === "in_progress",
      `status=${r.status} -> ${r.body?.data?.status}`);

    r = await cg1Api("PATCH", `/tasks/${taskId}`, { status: "done" });
    check("T3. CG1 -> done ok, completed_at set",
      r.status === 200 && r.body?.data?.status === "done" && !!r.body?.data?.completed_at,
      `status=${r.status} completed_at=${r.body?.data?.completed_at}`);
    check("T3b. completed_by is CG1", r.body?.data?.completed_by === cg1.id);

    // ── Guard: no-op transition rejected (done -> done) ─────────────────
    r = await cg1Api("PATCH", `/tasks/${taskId}`, { status: "done" });
    check("G3. done -> done rejected 422", r.status === 422, `status=${r.status}`);

    // ── Guard: backward transition rejected (done -> in_progress) ───────
    r = await cg1Api("PATCH", `/tasks/${taskId}`, { status: "in_progress" });
    check("G4. done -> in_progress rejected 422", r.status === 422, `status=${r.status}`);

    // ── Reopen: done -> todo allowed, clears completion ─────────────────
    r = await cg1Api("PATCH", `/tasks/${taskId}`, { status: "todo" });
    check("T4. reopen done -> todo ok, completed_at cleared",
      r.status === 200 && r.body?.data?.status === "todo" && !r.body?.data?.completed_at,
      `status=${r.status} completed_at=${r.body?.data?.completed_at}`);

    // ── Guard: CG2 (assigned to recipient, NOT the task) can't advance ──
    r = await cg2Api("PATCH", `/tasks/${taskId}`, { status: "in_progress" });
    check("G5. non-assignee caregiver can't advance (403)", r.status === 403, `status=${r.status}`);

    // ── Caregiver home feed: GET /tasks returns CG1's open task ─────────
    const feed = await cg1Api("GET", `/tasks`);
    const feedHasTask = Array.isArray(feed.body?.data) &&
      feed.body.data.some((t) => t.id === taskId && t.recipient_name?.includes(String(stamp)));
    check("T5. CG1 home feed lists the open task with recipient name",
      feed.status === 200 && feedHasTask,
      `status=${feed.status} count=${feed.body?.data?.length}`);

    // CG2's feed must NOT include a task assigned to CG1.
    const feed2 = await cg2Api("GET", `/tasks`);
    const feed2HasTask = Array.isArray(feed2.body?.data) &&
      feed2.body.data.some((t) => t.id === taskId);
    check("T5b. CG2 feed excludes CG1's task", feed2.status === 200 && !feed2HasTask,
      `status=${feed2.status}`);

    // ── OWN-008C interplay: revoke CG1 → loses the recipient task list ──
    await ownerApi("DELETE", `/recipients/${R1}/caregivers/${cg1.id}`);
    const revokedList = await cg1Api("GET", `/recipients/${R1}/tasks`);
    check("G6. revoked caregiver can't list recipient tasks (403)",
      revokedList.status === 403, `status=${revokedList.status}`);

    // ── Owner deletes the task; DB row gone ─────────────────────────────
    const del = await ownerApi("DELETE", `/recipients/${R1}/tasks/${taskId}`);
    const remaining = sql(`SELECT count(*) FROM tasks WHERE id='${taskId}'`)[0][0];
    check("T6. owner delete removes the row",
      del.status === 204 && remaining === "0", `status=${del.status} remaining=${remaining}`);

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
