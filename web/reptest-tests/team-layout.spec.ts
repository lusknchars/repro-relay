import { expect, test } from "@playwright/test";

test("Team keeps one shared conversation beside selected work and real evidence", async ({
  page,
}) => {
  const title = `Team context fixture ${Date.now()}`;
  const created = await page.request.post("/api/v1/cases", {
    data: {
      title,
      project: "Team layout fixture",
      description: "Synthetic report for Team layout checks.",
      expected: "Review recorded evidence",
      url: "https://example.com",
      build: "fixture-build",
    },
  });
  expect(created.ok()).toBeTruthy();
  const record = await created.json();
  const observed = await page.request.post(
    `/api/v1/cases/${record.id}/observations`,
    {
      data: {
        revision: record.revision,
        result: "needs_context",
        observed: "Fixture observation: export stalls",
        steps: "Open fixture export",
        build: "fixture-build",
        evidence_url: "https://example.com/evidence",
        author: "Fixture observer",
      },
    },
  );
  expect(observed.ok()).toBeTruthy();
  let writes: { id: string; body: string }[] = [];
  let fail = true;
  await page.route("**/api/v1/chat", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({
        status: fail ? 503 : 200,
        json: fail ? { detail: "Fixture connection interrupted" } : {},
      });
    }
    return route.fulfill({
      json: {
        configured: true,
        connection: { connected: false, last_seen: null },
        items: [
          {
            id: "fixture-message",
            author: "Fixture teammate",
            body: "Please inspect the export evidence.",
            created_at: "2026-09-14T12:00:00Z",
            reply: "Fixture Hermes reply: the evidence needs review.",
            replied_at: "2026-09-14T12:01:00Z",
          },
        ],
      },
    });
  });
  await page.setViewportSize({ width: 1720, height: 1000 });
  await page.goto("/?view=team");
  const desk = page.getByRole("region", {
    name: "Team workspace",
    exact: true,
  });
  await expect(
    page.getByRole("complementary", { name: "Workspace context", exact: true }),
  ).toHaveCount(0);
  await desk.getByLabel("Search team work").fill(title);
  await desk.getByRole("button", { name: new RegExp(title) }).click();
  const context = page.getByRole("complementary", {
    name: "Shared context",
    exact: true,
  });
  await expect(
    context.getByText("Fixture observation: export stalls"),
  ).toBeVisible();
  await expect(
    context.getByRole("link", { name: "Open in Work" }),
  ).toHaveAttribute("href", `/?case=${record.id}`);
  const chat = page.getByRole("region", { name: "Hermes team conversation" });
  await expect(
    chat.getByText("Waiting for agent", { exact: true }),
  ).toBeVisible();
  await expect(
    chat.getByText("Fixture Hermes reply: the evidence needs review."),
  ).toBeVisible();
  expect(writes).toHaveLength(0);
  await chat.getByRole("button", { name: "Attach work", exact: true }).click();
  await expect(chat.getByLabel("Message Hermes")).toHaveValue(
    new RegExp(record.id),
  );
  await chat
    .getByRole("button", { name: "Send to Hermes", exact: true })
    .click();
  await expect(chat.getByRole("alert")).toHaveText(
    "Fixture connection interrupted",
  );
  await expect(chat.getByLabel("Message Hermes")).toHaveValue(
    new RegExp(record.id),
  );
  fail = false;
  await chat.getByLabel("Message Hermes").press("Control+Enter");
  await expect(chat.getByRole("status")).toHaveText(
    "Message saved for Hermes.",
  );
  expect(writes).toHaveLength(2);
  expect(writes[0].id).toBe(writes[1].id);
  await page.screenshot({ path: "test-results/team-desk-light.png" });
  await page.reload();
  await expect(
    context.getByText("Fixture observation: export stalls"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.screenshot({ path: "test-results/team-desk-dark.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await desk.getByRole("button", { name: "Hide shared context" }).click();
  await desk.getByRole("button", { name: "Show team conversations" }).click();
  await desk
    .getByRole("button", { name: "Team conversation Everyone" })
    .click();
  await expect(chat.getByLabel("Message Hermes")).toBeVisible();
  await expect(
    chat.getByRole("button", { name: "Attach work", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/team-desk-mobile.png" });
});
