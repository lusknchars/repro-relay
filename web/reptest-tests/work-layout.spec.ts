import { expect, test } from "@playwright/test";

test("work uses three proportional panes and keeps warnings scoped to the selected attempt", async ({ page }) => {
  const stamp = Date.now();
  const created = [];
  for (const title of [`Layout blocked ${stamp}`, `Layout unstarted ${stamp}`]) {
    const response = await page.request.post("/api/v1/cases", { data: {
      title, project: "Layout fixture", url: "https://example.com", description: "Fixture report for layout validation.", expected: "Readable evidence", build: "layout-build",
    } });
    expect(response.ok()).toBeTruthy();
    created.push(await response.json());
  }
  const [blocked, unstarted] = created;
  await page.route(`**/api/v1/cases/${blocked.id}/runs`, route => route.fulfill({ json: [{
    id: "layout-run", case_id: blocked.id, version: 1, case_revision: 1,
    status: "failed", detail: "Fixture: model request blocked by provider credit balance.",
    build: "layout-build", context_stale: false, context: { fixture: true },
    created_at: new Date().toISOString(), checked_at: new Date().toISOString(),
    output: null, events: [], usage: null,
  }] }));
  await page.route("**/api/v1/runs/layout-run/*", route => route.fulfill({ json: { items: [], next_cursor: null } }));
  await page.goto(`/?case=${blocked.id}`);
  const checklist = page.getByRole("region", {name:"Investigation record checklist"});
  await expect(checklist.getByRole("progressbar", {name:"Record coverage"})).toHaveAttribute("value", "3");
  await checklist.getByRole("button", {name:/Reported behavior/}).click();
  await expect(checklist.getByText("Fixture report for layout validation.")).toBeVisible();
  await checklist.getByRole("button", {name:"Inspect evidence"}).click();
  await expect(page.getByRole("tab", {name:"findings",exact:true})).toBeFocused();
  const warning = page.getByRole("status", { name: "Investigation warning" });
  await expect(warning).toContainText("provider credit balance");
  await expect(page.getByRole("complementary", { name: "Workspace context", exact: true })).toHaveCount(0);
  const history = page.getByRole("region", { name: "Work history", exact: true });
  const conversation = page.getByRole("region", { name: "Work conversation", exact: true });
  const evidence = page.getByRole("region", { name: "Evidence inspector", exact: true });
  const boxes = await Promise.all([history, conversation, evidence].map(locator => locator.boundingBox()));
  expect(boxes.every(Boolean)).toBe(true);
  expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x + 1);
  expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x + 1);
  expect(boxes[2]!.width).toBeGreaterThan(boxes[1]!.width);
  await page.getByRole("tab", { name: "findings", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Context used", exact: true })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText("Frozen context");
  await page.getByLabel("Search work", { exact: true }).fill("Layout ");
  await history.getByRole("button", { name: new RegExp(unstarted.title) }).click();
  await expect(page.getByRole("heading", { name: unstarted.title, exact: true })).toBeVisible();
  await expect(page.getByText("Fixture: model request blocked by provider credit balance.", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Search work", { exact: true })).toHaveValue("Layout ");
  await page.screenshot({ path: "test-results/work-wireframe-light.png" });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.screenshot({ path: "test-results/work-wireframe-dark.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Work history", exact: true }).click();
  await history.getByRole("button", { name: new RegExp(blocked.title) }).click();
  await expect(warning).toContainText("provider credit balance");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
