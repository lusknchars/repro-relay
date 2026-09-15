import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/account", route => route.fulfill({ json: { enabled: true, authenticated: true, local_access: true, role: "owner", profile: { id: "sentry-fixture-owner", name: "Fixture owner", username: "fixture" } } }));
});

test("Sentry account setup checks access before enabling a selected project", async ({ page }) => {
  let configured = false;
  let enabled = true;
  await page.route("**/api/v1/connections/sentry", route => route.fulfill({ json: { configured, syncing: false, settings: configured ? { organization: "fixture-org", project: "fixture-app", relay_project: "Fixture app", enabled } : null, progress: {} } }));
  await page.route("**/api/v1/connections/sentry/projects", route => {
    const body = route.request().postDataJSON();
    return body.token === "bad-fixture-token" ? route.fulfill({ status: 502, json: { detail: "Sentry rejected the token." } }) : route.fulfill({ json: { items: [{ slug: "fixture-app", name: "Fixture app" }] } });
  });
  await page.route("**/api/v1/connections/sentry/connect", async route => {
    expect(route.request().postDataJSON()).toMatchObject({ organization: "fixture-org", token: "good-fixture-token", project: "fixture-app", relay_project: "Fixture app", enabled: true });
    configured = true; await route.fulfill({ json: { configured: true } });
  });
  await page.route("**/api/v1/connections/sentry/enabled", async route => { enabled = route.request().postDataJSON().enabled; await route.fulfill({ json: { enabled } }); });
  await page.route("**/api/v1/connections/sentry/disconnect", async route => { configured = false; await route.fulfill({ json: { configured: false } }); });
  await page.goto("/?view=settings");
  await page.getByRole("button", { name: /^Sentry Reported bugs/ }).click();
  const connection = page.getByRole("region", { name: "Sentry connection", exact: true });
  await connection.getByLabel("Organization slug").fill("fixture-org");
  await connection.getByLabel("Sentry API token").fill("bad-fixture-token");
  await connection.getByRole("button", { name: "Connect Sentry", exact: true }).click();
  await expect(connection.getByRole("alert")).toContainText("rejected");
  await connection.getByLabel("Sentry API token").fill("good-fixture-token");
  await connection.getByRole("button", { name: "Connect Sentry", exact: true }).click();
  await expect(connection.getByRole("combobox", { name: "Sentry project", exact: true })).toHaveValue("fixture-app");
  await connection.getByRole("button", { name: "Enable Sentry monitoring" }).click();
  await expect(connection).toContainText("Monitoring enabled");
  await expect(connection.getByLabel("Sentry API token")).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("good-fixture-token");
  await page.reload();
  await page.getByRole("button", { name: /^Sentry Reported bugs/ }).click();
  await expect(connection).toContainText("fixture-org / fixture-app");
  await connection.getByRole("button", { name: "Pause monitoring" }).click();
  await expect(connection.getByRole("button", { name: "Resume monitoring" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await connection.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/sentry-account-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await connection.getByText("Manage connection", { exact: true }).click();
  await connection.getByRole("button", { name: "Disconnect Sentry" }).click();
  await expect(connection.getByLabel("Sentry API token")).toHaveValue("");
});

test("Sentry notifications include the release and open real work without claiming verification", async ({ page }) => {
  const response = await page.request.post("/api/v1/cases", { data: { title: "Sentry fixture export error", project: "Sentry fixture", url: "https://example.test", description: "Sentry reported an export error.", expected: "Establish reproduction conditions.", build: "release-fixture" } });
  expect(response.ok()).toBe(true); const work = await response.json();
  let read = false;
  await page.route("**/api/v1/sentry/alerts", route => route.fulfill({ json: { unread: read ? 0 : 1, items: [{ id: "fixture-alert", case_id: work.id, read, created_at: "2026-09-15T12:00:00Z", work_status: "new", alert: { kind: "new_issue", message: "Export error in release-fixture. A resolved Sentry issue is not a verified fix.", issue: { title: "Export error", release: "release-fixture", environment: "production", status: "resolved", url: "https://fixture-org.sentry.io/issues/123/" } } }] } }));
  await page.route("**/api/v1/sentry/alerts/fixture-alert/read", async route => { read = true; await route.fulfill({ json: { read: true } }); });
  await page.goto("/?view=work");
  await page.getByRole("button", { name: "Bug notifications: 1 unread" }).click();
  await expect(page.getByRole("heading", { name: "Sentry bug notifications" })).toBeVisible();
  await expect(page.getByText("Release: release-fixture", { exact: false })).toBeVisible();
  await page.getByText("Message preview", { exact: true }).click();
  await expect(page.getByText("Export error in release-fixture.", { exact: false })).toContainText("not a verified fix");
  await page.screenshot({ path: "test-results/sentry-notifications-light.png", fullPage: true });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open investigation", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/sentry-notifications-dark-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(page.getByText("0 unread", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open investigation", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(work.id));
  await expect(page.getByRole("heading", { name: "Sentry fixture export error", exact: true })).toBeVisible();
});
