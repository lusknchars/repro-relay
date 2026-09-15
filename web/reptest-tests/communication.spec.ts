import { expect, test } from "@playwright/test";

test("communication preferences, role routing and call requests persist without claiming delivery", async ({
  page,
}) => {
  const project = `Communication ${Date.now()}`;
  const personName = `Tester ${project}`;
  const created = await page.request.post("/api/v1/cases", {
    data: {
      title: "Calendar permissions investigation",
      project,
      url: "https://example.com",
      description: "Viewer calendar fails",
      expected: "Viewer sees the event",
      build: "ui-test-build",
    },
  });
  expect(created.ok()).toBeTruthy();
  const item = await created.json();
  await page.goto("/?view=team");
  await page.getByRole("button", { name: "Team settings", exact: true }).click();
  await page.getByRole("button", { name: "Add communication profile" }).click();
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel("Phone with country code") });
  await form.getByLabel("Name", { exact: true }).fill(personName);
  await form.getByLabel("Project name").fill(project);
  await form.getByLabel("Work role").selectOption("qa");
  await form.getByLabel("Phone with country code").fill("+15555550123");
  await form
    .getByLabel("What should updates focus on?")
    .fill("Viewer role on Windows");
  await form.getByLabel("Include this person").check();
  await form.getByRole("button", { name: "Save preferences" }).click();
  await expect(
    page.getByText("Preferences saved.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  // Wait for the persisted directory before opening its uncontrolled disclosure.
  await expect(page.getByText(personName, { exact: true })).toBeVisible();
  await page.getByText("Preview role-based updates", { exact: true }).click();
  await page.getByLabel("Case", { exact: true }).selectOption(item.id);
  await page
    .getByRole("button", { name: "Prepare update suggestions" })
    .click();
  await expect(page.getByText(/Check the reported expectation/)).toBeVisible();
  await expect(
    page.getByText(/current Plow adapter accepts only its granted owner chat/),
  ).toBeVisible();
  const members = await (
    await page.request.get("/api/v1/communication/members")
  ).json();
  const member = members.items.find((m: any) => m.member.project === project);
  expect(member.phone_verified).toBe(false);
  const start = await page.request.post("/api/v1/communication/calls", {
    data: {
      case_id: item.id,
      member_id: member.id,
      member_version: member.version,
      consent: true,
    },
  });
  const call = await start.json();
  expect(start.ok()).toBeTruthy();
  await page.request.put(
    `/api/v1/communication/calls/${call.id}/requests/11111111-1111-4111-8111-111111111111`,
    {
      headers: { "X-Relay-Call-Token": call.token },
      data: {
        kind: "test_request",
        transcript: `${project}: Please check the viewer role on Edge.`,
      },
    },
  );
  await page.reload();
  await expect(
    page.getByText(`test_request: ${project}: Please check the viewer role on Edge.`),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close context" }).first().click();
  await expect(
    page.getByText(`${personName} · Closed or expired`),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("recorded environment is available in the investigation preview and remains distinct from a passed test", async ({
  page,
}) => {
  const response = await page.request.post("/api/v1/cases", {
    data: {
      title: `Environment check ${Date.now()}`,
      project: "Environment UI",
      url: "https://example.com",
      description: "A viewer cannot open calendar",
      expected: "Calendar opens",
      build: "build-ui-42",
    },
  });
  const item = await response.json();
  await page.goto(`/?view=work&case=${item.id}`);
  await page.getByText("Reproduction conditions", { exact: true }).click();
  await page.getByRole("button", { name: "Record conditions" }).click();
  await page.getByLabel("Test account role").fill("viewer");
  await page
    .getByLabel("Browser and operating system")
    .fill("Edge on Windows 11");
  await page
    .getByLabel("Test data and prerequisites")
    .fill("One event on the shared test calendar");
  await page.getByRole("button", { name: "Save conditions" }).click();
  await expect(
    page.getByText("Edge on Windows 11", { exact: true }),
  ).toBeVisible();
  const preview = await (
    await page.request.get(`/api/v1/cases/${item.id}/investigation-preview`)
  ).json();
  expect(
    preview.context.reproduction_conditions.record.conditions.account_role,
  ).toBe("viewer");
  expect(preview.context.reproduction_conditions.verification).toBe(
    "human_recorded_conditions",
  );
  await page.reload();
  await page.getByText("Reproduction conditions", { exact: true }).click();
  await expect(
    page.getByText("Edge on Windows 11", { exact: true }),
  ).toBeVisible();
});

test("Google setup and read-only calendar events expose honest provider states", async ({
  page,
}) => {
  // Only provider boundaries are fixtures; the Relay calendar still uses its real API.
  await page.route("**/api/v1/connections/google-calendar", (route) =>
    route.fulfill({
      json: { configured: false, authorized: false, connecting: false },
    }),
  );
  await page.goto("/?view=settings&connection=calendar");
  await expect(
    page.getByRole("button", { name: "Connect Google Calendar" }),
  ).toBeDisabled();
  await page.getByText("Set up Google access once").click();
  await expect(
    page.getByText(".data/google-calendar/client.json", { exact: true }),
  ).toBeVisible();
  const today = new Date().toISOString().slice(0, 10);
  await page.route("**/api/v1/connections/google-calendar/events?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "google:fixture",
            version: 0,
            source: "google",
            pin: {
              title: "Google review fixture",
              starts_on: today,
              ends_on: today,
              category: "google",
              status: "recorded",
              notes: "10:00 UTC to 11:00 UTC",
              case_id: null,
            },
          },
        ],
        truncated: false,
        timezone: "UTC",
      },
    }),
  );
  await page.goto("/?view=calendar");
  await page.getByRole("button", { name: "Load Google Calendar" }).click();
  await page
    .getByRole("button", { name: /Google review fixture/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Google Calendar event" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Google Calendar · Read-only"),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Save activity" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("workflow library and modal picker select the same canvas step", async ({
  page,
}) => {
  await page.goto("/?view=architecture");
  await page
    .getByRole("button", { name: "Team workflow", exact: true })
    .click();
  await page.getByLabel("Search workflow steps").fill("human");
  await page
    .getByRole("button", { name: "Inspect Human review", exact: true })
    .click();
  await expect(
    page
      .getByRole("complementary", { name: "Workflow inspector" })
      .getByRole("heading", { name: "Human review" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Find workflow step", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "Find workflow step" });
  await picker.getByLabel("Search nodes in picker").fill("Hermes");
  await picker.getByRole("button").filter({ hasText: "Hermes" }).click();
  await expect(picker).not.toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Workflow inspector" }),
  ).toContainText("Hermes");
  await page.getByRole("button", { name: "Fit workflow to view" }).click();
  await page.screenshot({
    path: "test-results/workflow-reference-light.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Git contribution activity shows real captured attribution and searchable history", async ({
  page,
}) => {
  const feed = await (await page.request.get("/api/v1/autonomy")).json();
  const repository = feed.control.repository || "Contribution UI fixture";
  if (!feed.control.repository)
    await page.request.post("/api/v1/autonomy/scans", {
      data: { repository, revision: "a".repeat(40), files: [] },
    });
  const saved = await page.request.post("/api/v1/contributions", {
    data: {
      repository,
      revision: "a".repeat(40),
      commits: [
        {
          sha: "a".repeat(40),
          author: "Team Builder",
          subject: "Repair shared calendar permissions",
          committed_at: new Date().toISOString(),
        },
      ],
    },
  });
  expect(saved.ok()).toBeTruthy();
  await page.goto("/?view=team");
  await page.getByRole("button", { name: "Team settings", exact: true }).click();
  const activity = page.getByRole("region", {
    name: "Recent code contributions",
  });
  await expect(
    activity
      .getByRole("list")
      .first()
      .getByText("Team Builder", { exact: true }),
  ).toBeVisible();
  await activity
    .getByRole("button", { name: "View all contributions" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Contribution history" });
  await dialog.getByLabel("Search contributions").fill("not-matching");
  await expect(dialog.getByText("No matching contributions.")).toBeVisible();
  await dialog.getByLabel("Search contributions").fill("calendar");
  await expect(
    dialog.getByText("Repair shared calendar permissions"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
