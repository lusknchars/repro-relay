import { test, expect } from "@playwright/test";
test("Team lists teammates and opens their profile without creating a private conversation", async ({
  page,
}) => {
  let chatWrites = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/chat"))
      chatWrites++;
  });
  await page.route("**/api/v1/team/directory", (route) =>
    route.fulfill({
      json: {
        has_more: false,
        members: [
          { id: "fixture-travis", name: "Travis Fixture", role: "owner" },
          { id: "fixture-dina", name: "Dina Fixture", role: "viewer" },
        ],
      },
    }),
  );
  await page.goto("/?view=team");
  await page.getByLabel("Search teammates").fill("Dina");
  await page
    .getByRole("button", { name: "Inspect teammate Dina Fixture" })
    .click();
  const profile = page.getByRole("region", { name: "Teammate profile" });
  await expect(
    profile.getByText("Dina Fixture", { exact: true }),
  ).toBeVisible();
  await expect(profile).toContainText("shared Hermes conversation");
  await profile
    .getByRole("button", { name: "Open shared conversation" })
    .click();
  await expect(page.getByLabel("Message Hermes")).toBeFocused();
  expect(chatWrites).toBe(0);
  await page.getByLabel("Search teammates").fill("");
  await page.screenshot({ path: "test-results/team-people.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Show team conversations" }).click();
  await expect(
    page.getByRole("button", { name: "Inspect teammate Dina Fixture" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
