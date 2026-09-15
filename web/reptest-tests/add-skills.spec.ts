import { test, expect } from "@playwright/test";

test("Add skills previews a local file without changing the active agent", async ({ page }) => {
  const writes: string[] = [];
  await page.goto("/?view=agents");
  const trigger = page.getByRole("button", { name: "Add skills", exact: true });
  await expect(trigger).toBeVisible();
  page.on("request", request => {
    if (request.method() !== "GET" && request.method() !== "OPTIONS") writes.push(request.url());
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Add skills", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Upload skill file", { exact: true }).setInputFiles({
    name: "SKILL.md", mimeType: "text/markdown",
    buffer: Buffer.from("---\nname: test-skill\ndescription: A fixture\n---\n<script>window.skillExecuted = true</script>\nReview the evidence."),
  });
  await expect(dialog.getByRole("region", { name: "Skill file preview" })).toContainText("Review the evidence.");
  await expect(dialog).toContainText("Skill installation is not connected yet");
  expect(await page.evaluate(() => "skillExecuted" in window)).toBe(false);
  expect(writes).toEqual([]);
  await page.screenshot({ path: "test-results/add-skills-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog.getByRole("region", { name: "Skill file preview" })).toHaveCount(0);
  await dialog.getByLabel("Upload skill file", { exact: true }).setInputFiles({ name: "skills.zip", mimeType: "application/zip", buffer: Buffer.from("not a skill") });
  await expect(dialog.getByRole("alert")).toContainText("ZIP files and folders are not supported yet");
  await dialog.getByLabel("Upload skill file", { exact: true }).setInputFiles({ name: "SKILL.md", mimeType: "text/markdown", buffer: Buffer.alloc(128 * 1024 + 1, "a") });
  await expect(dialog.getByRole("alert")).toContainText("up to 128 KB");
  await dialog.getByLabel("Upload skill file", { exact: true }).setInputFiles({ name: "SKILL.md", mimeType: "text/markdown", buffer: Buffer.from([0xff]) });
  await expect(dialog.getByRole("alert")).toContainText("UTF-8 text");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/add-skills-mobile.png" });
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
