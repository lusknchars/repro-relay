import { expect, test } from "@playwright/test";

// One endpoint returning an unexpected shape must not blank the whole Team page.
// team-communication reads people.data?.items and calls.data?.items, guarding data but not
// items, so a body without items throws "Cannot read properties of undefined" and unmounts the
// React root. Only the named endpoint is overridden in each case; everything else reaches the
// real API. The heading is checked after the malformed body lands, because an unmounted root
// takes the heading with it, which is a surer signal than any panel's visibility.
async function teamSurvives(page: import("@playwright/test").Page, endpoint: string) {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  await page.route(`**/api/v1/${endpoint}*`, (route) =>
    route.fulfill({ json: [] }),
  );
  const landed = page.waitForResponse((r) => r.url().includes(endpoint));
  await page.goto("/?view=team");
  await landed;
  try {
    await expect(
      page.getByRole("heading", { name: "Team", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    expect(crashes).toEqual([]);
  } catch (failure) {
    console.warn(
      `[resilience] ${endpoint} page errors:`,
      crashes.join(" | ") || "none",
    );
    throw failure;
  }
}

test("a malformed communication members response does not blank the Team page", async ({
  page,
}) => {
  await teamSurvives(page, "communication/members");
});

test("a malformed communication calls response does not blank the Team page", async ({
  page,
}) => {
  await teamSurvives(page, "communication/calls");
});
