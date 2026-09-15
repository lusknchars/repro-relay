import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

const content = "Fixture instructions. Never executed.\n";
const hash = createHash("sha256").update(content).digest("hex");
function fixture() {
  return {
    control: {
      version: 3,
      paused: false,
      connected: true,
      repository: "harness-fixture",
      latest_scan: "SCAN-fixture",
      last_seen: new Date().toISOString(),
    },
    history_limit: 100,
    items: [
      {
        id: "SCAN-fixture",
        repository: "harness-fixture",
        revision: "a".repeat(40),
        created_at: new Date().toISOString(),
        file_count: 2,
        bytes: content.length * 2,
        duplicate_bytes: content.length,
        files: [
          {
            path: "AGENTS.md",
            sha256: hash,
            bytes: content.length,
            duplicate: false,
          },
          {
            path: "docs/AGENTS.md",
            sha256: hash,
            bytes: content.length,
            duplicate: true,
          },
        ],
        proposal: {
          id: "PACK-fixture",
          version: 2,
          state: "pending",
          result: {
            input_bytes: 500,
            candidate_bytes: 400,
            saved_bytes: 100,
            quality_check: "Exact original instruction bytes reconstruct.",
            scope: "Storage only",
          },
        },
      },
    ],
  };
}

test("Harness preserves Memory and old links, with no repository read until requested", async ({
  page,
}) => {
  const reads: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/autonomy")) reads.push(req.url());
  });
  await page.goto("/?view=knowledge");
  await expect(
    page.getByRole("heading", { name: "Harness", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Memory", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/view=harness/);
  expect(reads).toEqual([]);
  await page
    .getByRole("navigation", { name: "Harness sections" })
    .getByRole("button", { name: "Skills & tools" })
    .click();
  await expect(
    page.getByRole("link", { name: "Open skills library" }),
  ).toHaveAttribute("href", "/?view=agents");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Harness tools" }),
  ).toBeVisible();
  expect(reads).toEqual([]);
});

test("context decisions use the displayed version; preview and pause never start models", async ({
  page,
}) => {
  const feed = fixture();
  const writes: { path: string; body: unknown }[] = [];
  await page.route("**/api/v1/autonomy", (route) =>
    route.fulfill({ json: feed }),
  );
  await page.route(
    "**/api/v1/autonomy/proposals/PACK-fixture/decision",
    async (route) => {
      writes.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON(),
      });
      feed.items[0].proposal.state = "accepted";
      feed.items[0].proposal.version++;
      await route.fulfill({ json: { state: "accepted" } });
    },
  );
  await page.route("**/api/v1/autonomy/context", (route) =>
    route.fulfill({
      json: {
        context: {
          schema_version: 1,
          scan_id: "SCAN-fixture",
          proposal_id: "PACK-fixture",
          revision: "a".repeat(40),
          bundle: {
            bodies: { [hash]: content },
            sources: [{ path: "AGENTS.md", body: hash }],
          },
        },
      },
    }),
  );
  await page.route("**/api/v1/autonomy/control", async (route) => {
    writes.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
    });
    feed.control.paused = true;
    feed.control.version++;
    await route.fulfill({ json: feed.control });
  });
  await page.goto("/?view=harness&harness-section=repository");
  await expect(
    page.getByRole("button", { name: "Approve context" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Approve context" }).click();
  await expect(page.getByRole("status")).toContainText("No model was started");
  await page.getByRole("button", { name: "Preview approved context" }).click();
  const preview = page.getByRole("region", {
    name: "Approved context preview",
  });
  await preview.locator("summary").click();
  await expect(
    preview.getByText(content.trim(), { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/harness-context-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Pause monitoring" }).click();
  await expect(preview).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Preview approved context" }),
  ).toBeDisabled();
  expect(writes).toEqual([
    {
      path: "/api/v1/autonomy/proposals/PACK-fixture/decision",
      body: { version: 2, decision: "approve" },
    },
    { path: "/api/v1/autonomy/control", body: { version: 3, paused: true } },
  ]);
});

test("stale context, conflicts and unavailable services remain honest and fit mobile", async ({
  page,
}) => {
  const feed = fixture();
  await page.route("**/api/v1/autonomy", (route) =>
    route.fulfill({ json: feed }),
  );
  await page.route("**/api/v1/autonomy/proposals/*/decision", (route) =>
    route.fulfill({
      status: 409,
      json: { detail: "Snapshot changed. Refresh before trying again." },
    }),
  );
  await page.goto("/?view=harness&harness-section=repository");
  await page.getByRole("button", { name: "Approve context" }).click();
  await expect(page.getByRole("alert")).toContainText("Snapshot changed");
  feed.control.connected = false;
  await page.getByRole("button", { name: "Refresh context" }).click();
  await expect(
    page.getByRole("button", { name: "Approve context" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/harness-context-mobile-dark.png",
    fullPage: true,
  });
  await page.route("**/api/v1/autonomy", (route) =>
    route.fulfill({
      status: 403,
      json: { detail: "Repository context is local only." },
    }),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("local only");
  await expect(
    page.getByRole("button", { name: "Approve context" }),
  ).toHaveCount(0);
});

test("history stays read-only for old snapshots and viewers; empty preview is not success", async ({
  page,
}) => {
  const feed = fixture();
  feed.control.latest_scan = "SCAN-newer";
  await page.route("**/api/v1/autonomy", (route) =>
    route.fulfill({ json: feed }),
  );
  await page.goto("/?view=harness&harness-section=activity&audit=SCAN-fixture");
  await expect(
    page.getByRole("list", { name: "Context evaluation history" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve context" }),
  ).toBeDisabled();
  feed.control.latest_scan = "SCAN-fixture";
  feed.items[0].proposal.state = "accepted";
  await page.route("**/api/v1/autonomy/context", (route) =>
    route.fulfill({ json: { context: null } }),
  );
  await page.getByRole("button", { name: "Refresh context" }).click();
  await page.getByRole("button", { name: "Preview approved context" }).click();
  await expect(page.getByRole("status")).toContainText(
    "No approved current snapshot",
  );
  await expect(
    page.getByRole("region", { name: "Approved context preview" }),
  ).toHaveCount(0);
  await page.route("**/api/v1/account", (route) =>
    route.fulfill({
      json: { enabled: true, authenticated: true, role: "viewer" },
    }),
  );
  feed.items[0].proposal.state = "pending";
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Approve context" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Pause monitoring" }),
  ).toBeDisabled();
});
