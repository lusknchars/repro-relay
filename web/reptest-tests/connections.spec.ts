import { expect, test } from "@playwright/test";

test("settings explains independent layers and routes account and knowledge in place", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") writes.push(r.url());
  });
  await page.route("**/api/v1/account", (r) =>
    r.fulfill({ json: { enabled: true, authenticated: false } }),
  );
  await page.route("**/api/v1/connections/plow", (r) =>
    r.fulfill({ json: { configured: true, grant_verified: false } }),
  );
  await page.route("**/api/v1/tool-profile", (r) =>
    r.fulfill({
      status: 503,
      json: { detail: "Memory preference unavailable." },
    }),
  );
  await page.goto("/?view=settings");
  for (const name of [
    "Agents",
    "Models",
    "Context and memory",
    "Communication",
  ]) {
    await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole("region", { name: "Communication", exact: true }),
  ).toContainText("Configured · check required");
  await page
    .getByRole("region", { name: "Models", exact: true })
    .getByRole("button")
    .click();
  await expect(
    page.getByRole("region", { name: "Connection details" }),
  ).toContainText("Model access for your configured Pi profile");
  await page
    .getByRole("region", { name: "Context and memory", exact: true })
    .getByRole("button", { name: /Mem0/ })
    .click();
  await expect(
    page.getByRole("region", { name: "Connection details" }),
  ).toContainText("Preference unavailable");
  await expect(
    page.getByRole("button", { name: "Enable private notes" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Account settings", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Relay account" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/view=settings/);
  await page
    .getByRole("button", { name: "Reviewed project knowledge", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "Knowledge", exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  await page.goto("/?view=settings");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("region", { name: "Communication", exact: true })
    .getByRole("button", { name: /Plow \+ Latch/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Connect Plow + Latch", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.screenshot({
    path: "test-results/settings-layers.png",
    fullPage: true,
  });
});

test("one Plow action verifies the line and reports a failed native launch separately", async ({
  page,
}) => {
  const calls: string[] = [];
  await page.exposeFunction("nativeRelay", async (command: string) => {
    calls.push(command);
    if (command === "account_request")
      return {
        status: 200,
        body: { enabled: true, authenticated: false },
        session_persistent: false,
      };
    if (command === "open_plow_latch")
      throw new Error("Latch is not installed");
    throw new Error("Unexpected native command");
  });
  await page.addInitScript(() =>
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: (command: string) =>
          (
            window as unknown as {
              nativeRelay: (command: string) => Promise<unknown>;
            }
          ).nativeRelay(command),
      },
    }),
  );
  let connects = 0;
  await page.route("**/api/v1/connections/plow/connect", async (r) => {
    connects++;
    return r.fulfill({
      json: {
        grant_verified: true,
        line_name: "Fixture line",
        checked_at: "2026-09-14T12:00:00Z",
        latch_advertised: true,
      },
    });
  });
  await page.goto("/?view=settings");
  await expect(
    page.getByRole("button", { name: "Check Plow connection", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open Plow Latch", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("python3 integrations/plow/connect.py --login", {
      exact: true,
    }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Connect Plow + Latch", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Open the installed Latch app",
  );
  await expect(
    page.getByRole("region", { name: "Connection details" }),
  ).toContainText("Fixture line");
  await expect(
    page.getByRole("region", { name: "Connection details" }),
  ).toContainText("Line grant verified");
  expect(connects).toBe(1);
  expect(calls.filter((c) => c === "open_plow_latch")).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Connection details" }),
  ).not.toContainText("Line grant verified");
  expect(connects).toBe(1);
});

test("new account opens a skippable team guide and Settings can replay it without writes", async ({
  page,
}) => {
  let registered = false;
  const anonymous = {
    enabled: true,
    authenticated: false,
    bootstrap_available: true,
  };
  const account = {
    enabled: true,
    authenticated: true,
    role: "owner",
    profile: {
      id: "guide-fixture",
      name: "Guide fixture",
      username: "guide",
      bio: "",
    },
  };
  let writes = 0;
  await page.route("**/api/v1/account", (r) =>
    r.fulfill({ json: registered ? account : anonymous }),
  );
  await page.route("**/api/v1/team", (r) =>
    r.fulfill({ json: { members: [], invites: [] } }),
  );
  await page.route("**/api/v1/account/register", (r) => {
    registered = true;
    writes++;
    return r.fulfill({ json: account });
  });
  await page.goto("/?view=work");
  await page.getByRole("button", { name: /^Account:/ }).click();
  const dialog = page.getByRole("dialog", { name: "Relay account" });
  await dialog
    .getByRole("button", {
      name: "Use an existing username account",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await dialog.getByLabel("Username", { exact: true }).fill("guide");
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("fixture password long enough");
  await dialog.getByLabel("Display name").fill("Guide fixture");
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const guide = page.getByRole("complementary", { name: "Workspace guide" });
  await expect(dialog).not.toBeVisible();
  await expect(guide.getByRole("heading")).toHaveText("Your account and team");
  for (const [route, title] of [
    ["settings", "Connect the parts your agent needs"],
    ["knowledge", "Inspect your team's knowledge"],
    ["work", "Follow the evidence and review changes"],
    ["usage", "Understand usage and limits"],
  ]) {
    await guide.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`view=${route}`));
    await expect(guide.getByRole("heading")).toHaveText(title);
    await expect(guide.getByRole("heading")).toBeFocused();
  }
  await guide.getByRole("button", { name: "Finish guide" }).click();
  await expect(guide).not.toBeVisible();
  await page.goto("/?view=settings");
  await expect(guide).not.toBeVisible();
  await page.getByRole("button", { name: "Guide me through Relay" }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(guide).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guide).not.toBeVisible();
  await page.goto("/?view=settings");
  await page.getByRole("button", { name: "Guide me through Relay" }).click();
  await guide.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("button", { name: "Reviewed project knowledge", exact: false })
    .click();
  await expect(page).toHaveURL(/view=knowledge/);
  await expect(guide).not.toBeVisible();
  expect(writes).toBe(1);
});
