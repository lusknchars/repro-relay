import { test, expect, type Page } from "@playwright/test";

const record = { id: "CASE-trial", title: "Export trial fixture", project: "Trial fixture", description: "Export produces no file.", expected: "Download one CSV.", build: "fixture-build", url: "http://127.0.0.1:4173/", revision: 1, owner_version: 1, status: "new", observations: [], events: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
const preview = { case_revision: 1, build: "fixture-build", context_hash: "a".repeat(64), context: { report: record, harness_context: { scan_id: "SCAN-trial", revision: "b".repeat(40) }, harness_trial: { task: "bug_investigation_v1" } } };
async function setup(page: Page, viewer = false) {
  await page.route("**/api/v1/account", route => route.fulfill({ json: { enabled: true, authenticated: true, role: viewer ? "viewer" : "owner" } }));
  await page.route(/\/api\/v1\/cases\?/, route => route.fulfill({ json: [record] }));
  await page.route("**/api/v1/workspace/runs", route => route.fulfill({ json: { items: [], next_offset: null } }));
  await page.route("**/api/v1/runner", route => route.fulfill({ json: { available: true } }));
  await page.route("**/api/v1/autonomy/context", route => route.fulfill({ json: { context: { scan_id: "SCAN-trial" } } }));
  await page.route("**/api/v1/cases/CASE-trial/investigation-preview?*", route => route.fulfill({ json: preview }));
  await page.goto("/?view=harness&harness-section=trial");
  await page.getByRole("combobox", { name: "Work record", exact: true }).selectOption(record.id);
}

test("trial previews without writes and retries an uncertain start with identical inputs", async ({ page }) => {
  const posts: { key: string | undefined; body: unknown }[] = [];
  await page.route("**/api/v1/cases/CASE-trial/runs", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] });
    posts.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
    if (posts.length === 1) return route.abort("failed");
    return route.fulfill({ status: 202, json: { id: "RUN-trial", case_id: record.id, context: preview.context, status: "queued", detail: "Fixture admission only.", usage: null, max_seconds: 60 } });
  });
  await setup(page);
  await page.getByRole("button", { name: "Preview trial context" }).click();
  await expect(page.getByRole("heading", { name: "Review before starting" })).toBeVisible();
  expect(posts).toEqual([]);
  await expect(page.getByRole("button", { name: "Start one trial" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Start one trial" }).click();
  await expect(page.getByRole("alert")).toContainText("Retry uses the same request");
  await expect(page.getByRole("combobox", { name: "Work record", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry same trial request" }).click();
  await expect(page.getByRole("article", { name: "Trial result" })).toContainText("Not reported");
  expect(posts).toHaveLength(2);
  expect(posts[0]).toEqual(posts[1]);
  expect(posts[0].body).toEqual({ revision: 1, max_seconds: 60, context_hash: preview.context_hash, harness_scan_id: "SCAN-trial" });
  await expect(page.getByRole("button", { name: "Trial admitted" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Open work, evidence and stop controls" })).toHaveAttribute("href", "/?view=work&case=CASE-trial");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/harness-trial-mobile.png", fullPage: true });
});

test("missing approval and viewer access cannot start a trial", async ({ page }) => {
  await page.route("**/api/v1/cases/CASE-trial/runs", route => route.fulfill({ json: [] }));
  await setup(page, true);
  await page.getByRole("button", { name: "Preview trial context" }).click();
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "Start one trial" })).toBeDisabled();
  await page.route("**/api/v1/autonomy/context", route => route.fulfill({ json: { context: null } }));
  await page.getByRole("button", { name: "Preview trial context" }).click();
  await expect(page.getByRole("alert")).toContainText("Approve the current instruction snapshot");
  await expect(page.getByRole("button", { name: "Start one trial" })).toHaveCount(0);
});
