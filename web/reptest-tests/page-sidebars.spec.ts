import { expect, test } from "@playwright/test";

test("Architecture shares one inner sidebar and preserves draft state when collapsed", async ({
  page,
}) => {
  await page.goto("/?view=architecture");
  const sidebar = page.getByRole("complementary", {
    name: "Workspace context",
    exact: true,
  });
  await expect(
    sidebar.getByRole("heading", { name: "Architecture explorer" }),
  ).toBeVisible();
  await sidebar
    .getByRole("button", { name: "Team workflow", exact: true })
    .click();
  await expect(
    sidebar.getByRole("region", { name: "Workflow templates" }),
  ).toBeVisible();
  const guidance = page.getByLabel("Team guidance", { exact: true });
  await guidance.fill("Unsaved sidebar fixture guidance");
  await sidebar.getByLabel("Search workflow steps").fill("human");
  await sidebar
    .getByRole("button", { name: "Inspect Human review", exact: true })
    .click();
  await expect(
    sidebar.getByRole("button", { name: "Inspect Human review", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  const canvas = await page
    .getByRole("region", { name: "Architecture canvas" })
    .boundingBox();
  const bounds = await sidebar.boundingBox();
  expect(canvas!.x - (bounds!.x + bounds!.width)).toBeLessThan(5);
  expect(canvas!.width).toBeGreaterThan(600);
  await sidebar
    .getByRole("button", { name: "Close workspace sidebar" })
    .click();
  await expect(sidebar).toHaveCount(0);
  await expect(guidance).toHaveValue("Unsaved sidebar fixture guidance");
  await page
    .getByRole("button", { name: "Show workspace context", exact: true })
    .click();
  await expect(sidebar.getByLabel("Search workflow steps")).toHaveValue(
    "human",
  );
  await page.reload();
  await expect(
    sidebar.getByRole("button", { name: "Team workflow", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/architecture-sidebar.png" });
});

test("Agents sections stay in the inner sidebar and remain usable on a narrow screen", async ({
  page,
}) => {
  await page.goto("/?view=agents");
  const sidebar = page.getByRole("complementary", {
    name: "Workspace context",
    exact: true,
  });
  await expect(
    sidebar.getByRole("button", { name: "Skills", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await sidebar.getByRole("button", { name: "Runtime", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Hermes runtime" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    sidebar.getByRole("button", { name: "Runtime", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await sidebar.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Recorded Hermes runs" }),
  ).toBeVisible();
  const primary = page.getByRole("complementary", { name: "Primary navigation", exact: true });
  await primary.getByRole("button", { name: "Knowledge", exact: true }).click();
  await expect(sidebar.getByRole("heading", { name: "Knowledge library" })).toBeVisible();
  await expect(sidebar.getByRole("navigation", { name: "Agent sections" })).toHaveCount(0);
  await primary.getByRole("button", { name: "Agents", exact: true }).click();
  await expect(sidebar.getByRole("button", { name: "Skills", exact: true })).toHaveAttribute("aria-current", "page");
  await sidebar.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.screenshot({ path: "test-results/agents-sidebar-dark.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await sidebar.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Skills library" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await sidebar
    .getByRole("button", { name: "Close workspace sidebar" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Show workspace context", exact: true }),
  ).toBeFocused();
});

test("Knowledge filters recorded observations by source without writing or losing selection", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && !request.url().endsWith("/account/local"))
      writes.push(request.url());
  });
  const records = [
    {
      id: "memory-a1",
      case_id: "source-a",
      title: "Export investigation",
      project: "Billing",
      observation: { observed: "Export fixture evidence" },
    },
    {
      id: "memory-a2",
      case_id: "source-a",
      title: "Export receipt",
      project: "Billing",
      observation: { observed: "Saved fixture receipt" },
    },
    {
      id: "memory-b1",
      case_id: "source-b",
      title: "Login investigation",
      project: "Accounts",
      observation: { observed: "Login fixture evidence" },
    },
  ].map((memory) => ({
    ...memory,
    revision: 1,
    reviewer: "Fixture reviewer",
    created_at: "2026-09-15T10:00:00Z",
    kind: "reviewed_observation",
    matched_terms: [],
  }));
  await page.route("**/api/v1/memories", (route) =>
    route.fulfill({ json: records }),
  );
  await page.goto("/?view=knowledge");
  const sidebar = page.getByRole("complementary", {
    name: "Workspace context",
    exact: true,
  });
  await expect(page.locator("main li")).toHaveCount(3);
  await sidebar.getByLabel("Find source reports").fill("Billing");
  await expect(
    sidebar.getByRole("button", { name: "Filter by Login investigation" }),
  ).toHaveCount(0);
  await sidebar
    .getByRole("button", { name: "Filter by Export investigation" })
    .click();
  await expect(page.locator("main li")).toHaveCount(2);
  await expect(
    page
      .locator("main")
      .getByRole("link", { name: "Open source report" })
      .first(),
  ).toHaveAttribute("href", "/?case=source-a");
  await page.reload();
  await expect(page.locator("main li")).toHaveCount(2);
  await expect(
    sidebar.getByRole("button", { name: "Filter by Export investigation" }),
  ).toHaveAttribute("aria-current", "page");
  await page
    .getByLabel("Search knowledge", { exact: true })
    .fill("no match fixture");
  await expect(
    page.getByText("No reviewed observations match these filters."),
  ).toBeVisible();
  await page.getByLabel("Search knowledge", { exact: true }).fill("");
  await sidebar
    .getByRole("button", { name: "All observations", exact: true })
    .click();
  await expect(page.locator("main li")).toHaveCount(3);
  await page.screenshot({ path: "test-results/knowledge-sidebar.png" });
  expect(writes).toEqual([]);
});

test("Knowledge source failure is visible without an invented empty library", async ({
  page,
}) => {
  await page.route("**/api/v1/memories", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Knowledge fixture unavailable" },
    }),
  );
  await page.goto("/?view=knowledge");
  await expect(page.getByRole("alert")).toHaveText(
    "Knowledge fixture unavailable",
  );
  await expect(
    page.getByText("Sources unavailable. Refresh knowledge to retry."),
  ).toBeVisible();
  await expect(
    page.getByText("No current reviewed observations.", { exact: false }),
  ).toHaveCount(0);
});
