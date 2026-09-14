import { expect, test } from "@playwright/test";

test("desktop account chooser signs in through IPC without navigating away", async ({
  page,
}) => {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  let signedIn = false;
  const anonymous = {
    enabled: true,
    authenticated: false,
    bootstrap_available: true,
  };
  const profile = {
    enabled: true,
    authenticated: true,
    role: "owner",
    profile: {
      id: "fixture",
      name: "Account fixture",
      username: "fixture",
      bio: "",
    },
  };
  await page.exposeFunction(
    "nativeAccount",
    async (
      command: string,
      args: { path: string; method: string; body?: { password?: string } },
    ) => {
      expect(command).toBe("account_request");
      calls.push(args);
      if (args.path === "/account/login") {
        if (args.body?.password !== "fixture password long enough")
          return {
            status: 401,
            body: { detail: "Username or password is incorrect." },
            session_persistent: false,
          };
        signedIn = true;
      }
      if (args.path === "/account/logout") signedIn = false;
      return {
        status: 200,
        body:
          args.path === "/team"
            ? { members: [], invites: [] }
            : signedIn
              ? profile
              : anonymous,
        session_persistent: true,
      };
    },
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: (command: string, args: unknown) =>
          (
            window as unknown as {
              nativeAccount: (c: string, a: unknown) => Promise<unknown>;
            }
          ).nativeAccount(command, args),
      },
    });
  });
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/account") || path.includes("/team"))
      throw new Error("Desktop account escaped native transport");
    return route.fulfill({
      json: path.endsWith("/runner")
        ? { available: false }
        : path.endsWith("/runs")
          ? { items: [], next_offset: null }
          : [],
    });
  });
  await page.goto("/?view=work");
  await page.getByRole("button", { name: /^Account:/ }).click();
  const dialog = page.getByRole("dialog", { name: "Relay account" });
  await expect(
    dialog.getByRole("heading", { name: "Sign in with your phone" }),
  ).toBeVisible();
  await expect(dialog.getByRole("link")).toHaveCount(0);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(
    dialog.getByRole("button", {
      name: "Use an existing username account",
      exact: true,
    }),
  ).toBeVisible();
  await dialog.screenshot({
    path: "test-results/account-chooser-dark.png",
    animations: "disabled",
  });
  await expect(dialog.getByLabel("Phone number")).toBeVisible();
  await expect(dialog.getByLabel("Username", { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Send verification code" }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", {
      name: "Use an existing username account",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await expect(dialog.getByLabel("Display name")).toBeVisible();
  await expect(dialog.getByLabel("Invitation link or token")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await dialog
    .getByRole("button", {
      name: "Use an existing username account",
      exact: true,
    })
    .click();
  await dialog.getByLabel("Username", { exact: true }).fill("fixture");
  await dialog.getByLabel("Password", { exact: true }).fill("wrong password");
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Username or password is incorrect.",
  );
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("fixture password long enough");
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Account fixture", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/view=work/);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "fixture password",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: /^Account:/ })).toBeFocused();
  await page.reload();
  await page.getByRole("button", { name: /^Account:/ }).click();
  await expect(
    dialog.getByRole("heading", { name: "Account fixture", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    dialog.getByRole("button", {
      name: "Use an existing username account",
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  const bounds = await dialog.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x || 0) + (bounds?.width || 0)).toBeLessThanOrEqual(320);
  expect(calls.filter((c) => c.path === "/account/login")).toHaveLength(2);
  expect(calls.filter((c) => c.path === "/account/logout")).toHaveLength(1);
});

test("phone sign-in verifies before asking for a name and uses native account transport", async ({
  page,
}) => {
  const calls: string[] = [];
  let authenticated = false;
  let verified = false;
  await page.exposeFunction(
    "nativePhone",
    async (
      command: string,
      args: { path: string; body?: Record<string, string> },
    ) => {
      expect(command).toBe("account_request");
      calls.push(args.path);
      const body = args.body || {};
      if (args.path === "/chat")
        return {
          status: 200,
          body: { items: [], configured: false, connection: null },
        };
      if (args.path === "/account/phone/start") {
        expect(body).toEqual({ phone: "+55 11 99999 9999" });
        return {
          status: 200,
          body: { challenge: "fixture-phone-proof", retry_after: 60 },
        };
      }
      if (args.path === "/account/phone/verify") {
        if (body.code !== "123456")
          return {
            status: 403,
            body: { detail: "The verification code is incorrect. Try again." },
          };
        verified = true;
        return { status: 200, body: { verified: true } };
      }
      if (args.path === "/account/phone/complete") {
        expect(verified).toBe(true);
        if (!body.name) return { status: 200, body: { needs_profile: true } };
        expect(body.name).toBe("Phone member");
        authenticated = true;
        return { status: 200, body: { authenticated: true, created: true } };
      }
      return {
        status: 200,
        session_persistent: true,
        body:
          args.path === "/team"
            ? { members: [], invites: [] }
            : {
                enabled: true,
                authenticated,
                bootstrap_available: true,
                phone_auth: { available: true, provider: "twilio_verify" },
                role: authenticated ? "owner" : null,
                profile: authenticated
                  ? {
                      name: "Phone member",
                      id: "fixture",
                      phone: "+5511999999999",
                      username: "phone_fixture",
                      bio: "",
                    }
                  : null,
              },
      };
    },
  );
  await page.addInitScript(() =>
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: (c: string, a: unknown) => (window as any).nativePhone(c, a),
      },
    }),
  );
  await page.goto("/?view=reach");
  await page.getByRole("button", { name: /^Account:/ }).click();
  const dialog = page.getByRole("dialog", { name: "Relay account" });
  await expect(dialog.getByLabel("Phone number")).toBeFocused();
  await expect(dialog.getByLabel("Display name")).toHaveCount(0);
  await dialog.getByLabel("Phone number").fill("+55 11 99999 9999");
  await dialog.getByRole("button", { name: "Send verification code" }).click();
  await expect(dialog.getByLabel("Verification code")).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: /Resend in/ }),
  ).toBeDisabled();
  await dialog.getByLabel("Verification code").fill("000000");
  await dialog.getByRole("button", { name: "Verify & continue" }).click();
  await expect(dialog.getByRole("alert")).toContainText("incorrect");
  expect(calls).not.toContain("/account/phone/complete");
  await dialog.getByLabel("Verification code").fill("123456");
  await dialog.getByRole("button", { name: "Verify & continue" }).click();
  await expect(dialog.getByLabel("Display name")).toBeFocused();
  await dialog.getByLabel("Display name").fill("Phone member");
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Workspace guide" }),
  ).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "fixture-phone-proof",
  );
  expect(calls).not.toContain("/account/register");
});
