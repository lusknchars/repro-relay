import { test, expect } from "@playwright/test";

test("skills open first and one click applies a real workflow without starting a run", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET")
      writes.push(new URL(request.url()).pathname);
  });
  await page.goto("/?view=agents");
  await expect(
    page.getByRole("heading", { name: "Skills library" }),
  ).toBeVisible();
  const catalog = await (
    await page.request.get("/api/v1/architectures")
  ).json();
  const candidate = catalog.templates.find(
    (item: any) => item.focus !== catalog.settings.focus,
  );
  const card = page
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: candidate.name, exact: true }),
    });
  await page.getByLabel("Filter skills").fill("nonexistent fixture");
  await expect(page.getByRole("status")).toHaveText(
    "No skills match your search.",
  );
  await page.getByLabel("Filter skills").fill("");
  await card.getByRole("button", { name: "Use skill" }).click();
  await expect(
    card.getByRole("button", { name: "Active skill" }),
  ).toBeDisabled();
  const updated = await (
    await page.request.get("/api/v1/architectures")
  ).json();
  expect(updated.settings).toEqual({
    ...catalog.settings,
    focus: candidate.focus,
  });
  expect(writes.filter((path) => !path.endsWith("/account/local"))).toEqual([
    "/api/v1/architectures",
  ]);
  await page.reload();
  await expect(
    card.getByRole("button", { name: "Active skill" }),
  ).toBeDisabled();
  await page.screenshot({ path: "test-results/agents-skills.png" });
  await page.locator('[aria-label="Skill layout"]').getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: "Runtime", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Hermes runtime" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("failed skill writes require a read before retry and do not change the active badge", async ({
  page,
}) => {
  await page.goto("/?view=agents");
  await expect(
    page.getByRole("heading", { name: "Skills library" }),
  ).toBeVisible();
  const catalog = await (
    await page.request.get("/api/v1/architectures")
  ).json();
  const candidate = catalog.templates.find(
    (item: any) => item.focus !== catalog.settings.focus,
  );
  await page.route("**/api/v1/architectures", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 503,
          json: { detail: "Fixture interrupted save" },
        })
      : route.continue(),
  );
  const card = page
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: candidate.name, exact: true }),
    });
  await card.getByRole("button", { name: "Use skill" }).click();
  await expect(page.getByRole("alert")).toHaveText("Fixture interrupted save");
  await expect(card.getByRole("button", { name: "Use skill" })).toBeDisabled();
  await page.getByRole("button", { name: "Refresh skill selection" }).click();
  await expect(card.getByRole("button", { name: "Use skill" })).toBeEnabled();
});
