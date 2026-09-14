import { expect, test } from "@playwright/test";

test("monitoring shows measured requests, private-safe details and a pausable console", async ({
  page,
}) => {
  await page.request.get(
    "/api/v1/cases/private-path-marker?token=private-query-marker",
  );
  await page.goto("/?view=monitoring");
  await expect(
    page.getByRole("heading", { name: "Monitoring", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Relay / PostgreSQL", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Available", { exact: true })).toBeVisible();
  const consoleView = page.locator('[aria-label="Request console"]');
  await page.getByLabel("Search request logs").fill("/cases/{id}");
  const log = consoleView.getByRole("button").first();
  await expect(log).toContainText("404");
  await log.click();
  const dialog = page.getByRole("dialog", { name: "Request details" });
  await expect(dialog).toContainText("/api/v1/cases/{id}");
  await expect(dialog).not.toContainText("private-path-marker");
  await expect(dialog).not.toContainText("private-query-marker");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.getByLabel("Search request logs").fill("");
  await page.getByRole("button", { name: "Pause live console" }).click();
  await expect(page.getByRole("button", { name: "Resume live console" })).toBeVisible();
  const before = await consoleView.innerText();
  await page.request.post("/api/v1/cases", {
    data: { title: "private-body-marker" },
  });
  await page.getByRole("button", { name: "Refresh monitoring" }).click();
  await expect(
    page.getByRole("button", { name: "Refresh monitoring" }),
  ).toBeEnabled();
  expect(await consoleView.innerText()).toBe(before);
  await page.getByRole("button", { name: "Clear console view" }).click();
  await expect(consoleView.getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: "Resume live console" }).click();
  await expect(consoleView.getByRole("button").first()).toContainText("422");
  await page.getByLabel("Request status filter").selectOption("errors");
  await expect(consoleView).not.toContainText("private-body-marker");
  const metrics = await (await page.request.get("/api/v1/monitoring")).json();
  expect(metrics.total_captured).toBeGreaterThan(0);
  expect(metrics.events.some((e: { status: number }) => e.status === 422)).toBe(
    true,
  );
  await page.getByLabel("Request status filter").selectOption("all");
  await page.screenshot({
    path: "test-results/monitoring-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.screenshot({
    path: "test-results/monitoring-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("monitoring failure remains visible without fabricated database health", async ({
  page,
}) => {
  await page.route("**/api/v1/monitoring", (route) =>
    route.fulfill({ status: 503, json: { detail: "Telemetry unavailable" } }),
  );
  await page.goto("/?view=monitoring");
  await expect(page.getByRole("alert")).toHaveText("Telemetry unavailable");
  await expect(page.getByText("Not checked", { exact: true })).toBeVisible();
  await expect(page.getByText("Available", { exact: true })).toHaveCount(0);
});
