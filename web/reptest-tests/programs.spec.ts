import { expect, test } from "@playwright/test";

test("administrator schedules an automatic routine and opens its recorded run", async ({
  page,
}) => {
  await page.goto("/?view=agents&agent-section=programs");
  const response = await page.request.post("/api/v1/cases", {
    data: {
      title: "Program browser fixture",
      project: "Program fixture",
      url: "http://127.0.0.1:4173/",
      description: "Fixture regression needs triage.",
      expected: "Record fixture evidence.",
      build: "program-fixture-build",
    },
  });
  expect(response.ok()).toBeTruthy();
  const record = await response.json();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Test programs", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New program", exact: true }).click();
  await page.getByRole("button", { name: /Test triage Sort/ }).click();
  await page
    .getByLabel("Program name", { exact: true })
    .fill("Automatic triage fixture");
  await page
    .getByRole("combobox", { name: "Repository work", exact: true })
    .selectOption(record.id);
  await expect(
    page.getByRole("combobox", { name: "At the scheduled time", exact: true }),
  ).toHaveValue("true");
  await page
    .getByRole("combobox", { name: "Repeat", exact: true })
    .selectOption("once");
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  await page.getByLabel("First run", { exact: true }).fill(local);
  await page.getByRole("button", { name: "Save program", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Program saved" }),
  ).toBeVisible();
  const row = page
    .locator(".program-history .program-row")
    .filter({ hasText: "Automatic triage fixture" });
  await expect(row.getByRole("button", { name: "View result" })).toBeVisible({
    timeout: 20000,
  });
  await page.reload();
  await expect(
    page
      .locator(".program-list .program-row")
      .filter({ hasText: "Automatic triage fixture" }),
  ).toContainText("No further scheduled runs");
  await row.getByRole("button", { name: "View result" }).click();
  await expect(page).toHaveURL(new RegExp(record.id));
  const runs = await (
    await page.request.get(`/api/v1/cases/${record.id}/runs`)
  ).json();
  expect(runs).toHaveLength(1);
  expect(runs[0].context.scheduled_protocol.routine).toBe("triage");
});

test("program draft survives refresh polling, pause persists, and mobile controls fit", async ({
  page,
}) => {
  await page.goto("/?view=agents&agent-section=programs");
  await page.getByRole("button", { name: "New program", exact: true }).click();
  await page
    .getByLabel("Program name", { exact: true })
    .fill("Unfinished schedule");
  await page.getByRole("button", { name: "Refresh programs" }).click();
  await expect(page.getByLabel("Program name", { exact: true })).toHaveValue(
    "Unfinished schedule",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const record = await (
    await page.request.post("/api/v1/cases", {
      data: {
        title: "Pause program fixture",
        project: "Pause fixture",
        url: "http://127.0.0.1:4173/",
        description: "A test fixture.",
        expected: "Save evidence.",
        build: "pause-fixture",
      },
    })
  ).json();
  const id = crypto.randomUUID();
  const preview = await (
    await page.request.get(`/api/v1/cases/${record.id}/investigation-preview`)
  ).json();
  expect(
    (
      await page.request.put(`/api/v1/programs/${id}`, {
        data: {
          version: 0,
          context_hash: preview.context_hash,
          settings: {
            name: "Pause schedule fixture",
            case_id: record.id,
            routine: "triage",
            first_at: new Date(Date.now() + 3600000).toISOString(),
            repeat: "weekly",
            automatic: true,
            max_seconds: 120,
          },
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Refresh programs" }).click();
  const row = page
    .locator(".program-list .program-row")
    .filter({ hasText: "Pause schedule fixture" })
    .last();
  await row.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    row.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New program", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Program name", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/programs-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/programs-desktop.png",
    fullPage: true,
  });
});
