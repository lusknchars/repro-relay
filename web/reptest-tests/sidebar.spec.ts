import { expect, test } from "@playwright/test";

test("workspace context follows navigation and remains usable when collapsed or narrow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?view=reach");
  const context = page.getByRole("complementary", {
    name: "Workspace context",
    exact: true,
  });
  await expect(context).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Team communication map" })).toBeVisible();
  await page.goto("/?view=calendar");
  await expect(
    context.getByRole("heading", { name: "Team planning" }),
  ).toBeVisible();
  await context.getByRole("button", { name: "Open team conversation" }).click();
  await expect(context).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Hermes team conversation" }),
  ).toBeVisible();
  await page.goto("/?view=calendar");
  await page
    .getByRole("button", { name: "Hide workspace context", exact: true })
    .click();
  await expect(context).toHaveCount(0);
  await page.reload();
  await expect(context).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Show workspace context", exact: true })
    .click();
  await expect(context).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Hide workspace context", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context
    .getByRole("button", { name: "Close workspace sidebar" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(context).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show workspace context", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Calendar", exact: true }),
  ).toBeVisible();
});
