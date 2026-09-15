import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
const key = (d: Date) => d.toISOString().slice(0, 10);

test("observed repository, editable team workflow and real Hermes research remain distinct", async ({
  page,
}) => {
  const feed = await (await page.request.get("/api/v1/autonomy")).json();
  const repository = feed.control.repository || "Architecture UI fixture";
  const scanned = await page.request.post("/api/v1/autonomy/scans", {
    data: {
      repository,
      revision: "a".repeat(40),
      files: [
        { path: "AGENTS.md", content: "Fixture architecture inspection." },
      ],
    },
  });
  expect(scanned.ok()).toBe(true);
  const snapshot = {
    repository,
    revision: "a".repeat(40),
    dirty: false,
    nodes: [
      {
        id: "Cargo.toml",
        name: "fixture-api",
        kind: "Rust manifest",
        technologies: ["axum"],
        dependencies: [],
        sha256: "b".repeat(64),
      },
      {
        id: "web/package.json",
        name: "fixture-web",
        kind: "JavaScript package",
        technologies: ["react"],
        dependencies: ["Cargo.toml"],
        sha256: "c".repeat(64),
      },
    ],
  };
  const observed = await page.request.post("/api/v1/architectures/repository", {
    data: snapshot,
  });
  expect(observed.ok()).toBe(true);
  await page.goto("/?view=architecture");
  await expect(
    page.getByRole("heading", { name: "Architecture", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "fixture-api workflow step" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "fixture-web workflow step" }).click();
  await expect(
    page.getByRole("complementary", { name: "Workflow inspector" }),
  ).toContainText("web/package.json");
  await expect(
    page.getByRole("button", { name: "Apply to team", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Use square grid" }).click();
  await expect(
    page.getByRole("button", { name: "Use dot grid" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Team workflow", exact: true })
    .click();
  await page
    .getByRole("button", { name: /^Context and token efficiency/ })
    .click();
  await page
    .getByLabel("Team guidance", { exact: true })
    .fill("Compare measured context costs and keep evidence sources.");
  await page.getByRole("button", { name: "Reset layout" }).click();
  const human = page.getByRole("button", {
    name: "Human review workflow step",
  });
  await human.focus();
  await page.keyboard.press("ArrowRight");
  await page
    .getByRole("button", { name: "Apply to team", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Applied to the team.");
  await page.reload();
  await page
    .getByRole("button", { name: "Team workflow", exact: true })
    .click();
  await expect(page.getByLabel("Team guidance", { exact: true })).toHaveValue(
    "Compare measured context costs and keep evidence sources.",
  );
  const saved = await (await page.request.get("/api/v1/architectures")).json();
  expect(saved.settings.focus).toBe("context_efficiency");
  expect(saved.settings.positions.human.x).toBe(100);
  await page
    .locator("aside")
    .first()
    .getByRole("button", { name: /^Team$/ })
    .click();
  await page.getByRole("button", { name: "Team settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Team investigation workflow" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Context and token efficiency · version/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open architecture" }).click();
  await page
    .getByRole("button", { name: "Research improvements · 2 min" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: `Architecture research: ${repository}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Controlled fixture proposal", { exact: false }),
  ).toBeVisible({ timeout: 25000 });
  await page
    .locator("aside")
    .first()
    .getByRole("button", { name: "Architecture", exact: true })
    .click();
  // Architecture now retains its selected view when returning from Work.
  await page.getByRole("button", { name: "Current repository", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Suggested improvements" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Architecture research:.*Open research and review/,
    }).first(),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/architecture-current.png" });
  await page
    .getByRole("button", { name: "Team workflow", exact: true })
    .click();
  await page.screenshot({ path: "test-results/architecture-workflow.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("calendar persists a multiday pin, edits it, exports a snapshot and removes it", async ({
  page,
}, testInfo) => {
  const today = key(new Date());
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 1);
  const title = `Architecture review ${Date.now()}`;
  await page.goto("/?view=calendar");
  await page.getByRole("button", { name: "Pin activity", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Calendar activity" });
  await dialog.getByLabel("Activity title", { exact: true }).fill(title);
  await dialog.getByLabel("Start date", { exact: true }).fill(today);
  await dialog.getByLabel("End date", { exact: true }).fill(key(end));
  await dialog
    .getByLabel("Notes", { exact: true })
    .fill("Compare sources, costs and measured results.");
  await dialog.getByRole("button", { name: "Save activity" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("Activity saved");
  await page.reload();
  await page.getByRole("button", { name: title, exact: true }).first().click();
  await expect(dialog.getByLabel("Notes", { exact: true })).toHaveValue(
    "Compare sources, costs and measured results.",
  );
  await dialog.getByLabel("Status", { exact: true }).selectOption("done");
  await dialog.getByRole("button", { name: "Save activity" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export calendar" }).click();
  const file = testInfo.outputPath("team.ics");
  await (await download).saveAs(file);
  const ics = await readFile(file, "utf8");
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(ics.replace(/\r\n /g, "")).toContain(title);
  expect(ics).toContain("DTSTART;VALUE=DATE:" + today.replace(/-/g, ""));
  await page.screenshot({ path: "test-results/calendar-team.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: new RegExp(title) }).last(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: new RegExp(title) })
    .last()
    .click();
  await dialog.getByRole("button", { name: "Remove activity" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: new RegExp(title) }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Calendar connections" }).click();
  await expect(
    page.getByRole("button", { name: "Open workspace calendar" }),
  ).toBeVisible();
});
