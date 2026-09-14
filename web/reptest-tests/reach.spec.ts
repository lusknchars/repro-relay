import { expect, test } from "@playwright/test";

test("Reach todos, decisions and local links survive reload", async ({
  page,
}) => {
  const title = `Reach todo ${Date.now()}`;
  await page.goto("/?view=reach");
  const reach = page.getByRole("region", { name: "Reach", exact: true });
  await reach.getByLabel("New Reach todo").fill(title);
  await reach.getByRole("button", { name: "Add todo", exact: true }).click();
  await expect(reach.getByRole("status")).toContainText("Todo added");
  await reach.getByRole("button").filter({ hasText: title }).click();
  await reach.getByLabel("Reach action").fill(`${title} · check Windows`);
  await reach.getByRole("button", { name: "Save action", exact: true }).click();
  await expect(reach.getByRole("status")).toContainText("nothing was sent");
  await page.reload();
  await reach
    .getByRole("button")
    .filter({ hasText: `${title} · check Windows` })
    .click();
  await expect(reach.getByText("Message draft · not sent")).toBeVisible();
  await reach.getByRole("button", { name: "Mark done", exact: true }).click();
  await expect(
    reach.getByRole("button").filter({ hasText: title }),
  ).toHaveCount(0);
  await reach.getByLabel("Include done and dismissed").check();
  await reach.getByRole("button").filter({ hasText: title }).click();
  const day = await reach.getByLabel("Reach day (UTC)").inputValue();
  const feed = await (await page.request.get(`/api/v1/reach?on=${day}`)).json();
  const item = feed.items.find((i: any) => i.title === title);
  expect(item.action.status).toBe("done");
  expect(item.action.delivery_status).toBe("not_sent");
  await page.goto(`/?view=reach&reach=${item.id}&day=${day}`);
  await expect(reach.getByLabel("Reach action")).toHaveValue(
    `${title} · check Windows`,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Reach rejects review after the source changed", async ({ page }) => {
  const title = `Reach stale ${Date.now()}`;
  const id = crypto.randomUUID();
  const day = new Date().toISOString().slice(0, 10);
  const pin = {
    title,
    starts_on: day,
    ends_on: day,
    category: "follow_up",
    status: "planned",
    notes: "Original scope",
    case_id: null,
  };
  expect(
    (
      await page.request.put(`/api/v1/calendar/${id}`, {
        data: { version: 0, pin },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/?view=reach&reach=calendar-${id}&day=${day}`);
  const reach = page.getByRole("region", { name: "Reach", exact: true });
  await expect(reach.getByLabel("Reach action")).toHaveValue(title);
  expect(
    (
      await page.request.put(`/api/v1/calendar/${id}`, {
        data: { version: 1, pin: { ...pin, notes: "Scope changed" } },
      })
    ).ok(),
  ).toBeTruthy();
  await reach.getByRole("button", { name: "Save action", exact: true }).click();
  await expect(reach.getByRole("alert")).toContainText(
    "source or team preferences changed",
  );
});

test("Reach is a primary page and old Team item links redirect to it", async ({
  page,
}) => {
  await page.goto("/?view=team");
  await expect(
    page.getByRole("region", { name: "Reach", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("complementary", { name: "Primary navigation" })
    .getByRole("button", { name: "Reach", exact: true })
    .click();
  await expect(page).toHaveURL(/view=reach/);
  await expect(
    page.getByRole("heading", { name: "Reach", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Reach", exact: true }),
  ).toBeVisible();
  await page.goto("/?view=team&reach=calendar-previous-link");
  await expect(page).toHaveURL(/view=reach/);
  await page
    .getByRole("complementary", { name: "Primary navigation" })
    .getByRole("button", { name: "Team", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Team", exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/reach=/);
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(
    page
      .getByRole("navigation", { name: "Phone navigation" })
      .getByRole("button", { name: "Reach", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
