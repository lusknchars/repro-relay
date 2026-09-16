import { expect, test } from "@playwright/test";

test("a pending pairing shows its code and no history", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  await page.route("**/api/v1/pair/state*", (route) =>
    route.fulfill({ json: { status: "pending", code: "7K2QAB" } }),
  );
  await page.goto("/?view=pairing");
  await expect(page.getByText("7K2QAB")).toBeVisible({ timeout: 15_000 });
  expect(crashes).toEqual([]);
});

test("a failed pairing state shows an alert instead of a blank screen", async ({ page }) => {
  await page.route("**/api/v1/pair/state*", (route) =>
    route.fulfill({ status: 500, json: { detail: "Pairing state unavailable." } }),
  );
  await page.goto("/?view=pairing");
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
});
