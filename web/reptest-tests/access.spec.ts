import { expect, test } from "@playwright/test";

test("local workspace opens without login and an invited teammate talks to the shared Hermes", async ({
  page,
  browser,
}) => {
  const suffix = crypto.randomUUID();
  const request = `Please help me review my first todo. ${suffix}`;
  const reply = `Test agent reply: start with the todo's acceptance criteria. ${suffix}`;
  await page.goto("/?view=team");
  await expect(
    page.getByText("Local workspace · no login required", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sign in with your phone" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Team settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Invite teammate by link", exact: true })
    .click();
  const link = await page
    .getByLabel("Invitation link", { exact: true })
    .inputValue();
  const teammate = await browser.newContext();
  const joined = await teammate.newPage();
  try {
    await joined.goto(link);
    await expect(
      joined.getByRole("heading", { name: "Join the workspace", exact: true }),
    ).toBeVisible();
    await joined
      .getByLabel("Your name", { exact: true })
      .fill("Invitation teammate");
    await joined
      .getByRole("button", { name: "Join workspace", exact: true })
      .click();
    await expect(
      joined.getByText("Joined by invitation", { exact: true }),
    ).toBeVisible();
    await expect(joined).not.toHaveURL(/#invite=/);
    await expect(
      joined.getByRole("button", {
        name: "Invite teammate by link",
        exact: true,
      }),
    ).toHaveCount(0);
    const chat = joined.getByRole("region", {
      name: "Hermes team conversation",
    });
    await chat
      .getByLabel("Message Hermes", { exact: true })
      .fill(request);
    await chat
      .getByRole("button", { name: "Send to Hermes", exact: true })
      .click();
    await expect(
      chat.getByText("Saved · waiting for Hermes", { exact: true }),
    ).toBeVisible();
    expect(
      (await joined.request.post("/api/v1/cases", { data: {} })).status(),
    ).toBe(403);
    expect(
      (await joined.request.post("/api/v1/chat/bridge", { data: {} })).status(),
    ).toBe(403);
    // Exercise the actual bridge protocol with a clearly identified test agent.
    const connection = await (
      await page.request.post("/api/v1/chat/bridge", { data: {} })
    ).json();
    const headers = { "x-relay-chat-key": connection.token };
    const pending = await (
      await page.request.get("/api/v1/chat/pending", { headers })
    ).json();
    const message = pending.items.find(
      (i: { body: string }) =>
        i.body === request,
    );
    expect(message).toBeTruthy();
    expect(
      (
        await page.request.post("/api/v1/chat/replies", {
          headers,
          data: {
            request_id: message.id,
            reply_id: crypto.randomUUID(),
            body: reply,
          },
        })
      ).ok(),
    ).toBeTruthy();
    await expect(
      chat.getByText(
        reply,
        { exact: true },
      ),
    ).toBeVisible();
    await joined.reload();
    await expect(
      joined.getByText("Joined by invitation", { exact: true }),
    ).toBeVisible();
    await expect(
      joined.getByText(
        reply,
        { exact: true },
      ),
    ).toBeVisible();
    await joined.setViewportSize({ width: 390, height: 844 });
    expect(
      await joined.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await teammate.close();
  }
});
