import { expect, test } from "@playwright/test";

const families = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Poppins",
  "DM Sans",
  "Montserrat",
  "Lato",
  "Mulish",
  "Work Sans",
  "IBM Plex Sans",
  "Ubuntu",
  "Nunito",
  "Outfit",
  "Space Grotesk",
  "Lexend",
];

test("every interface font loads locally, persists, and leaves code in monospace", async ({
  page,
}) => {
  const externalFonts: string[] = [];
  const failedFonts: string[] = [];
  page.on("request", (request) => {
    if (
      request.resourceType() === "font" &&
      new URL(request.url()).hostname !== "127.0.0.1"
    )
      externalFonts.push(request.url());
  });
  page.on("response", (response) => {
    if (response.request().resourceType() === "font" && !response.ok())
      failedFonts.push(response.url());
  });
  await page.goto("/?view=monitoring");
  await page.getByRole("button", { name: "Customize appearance" }).click();
  const select = page.getByRole("combobox", { name: "Interface font" });
  await expect(select.locator("option")).toHaveText([...families, "System"]);
  for (const family of families) {
    await select.selectOption({ label: family });
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.body).fontFamily),
      )
      .toContain(family);
    expect(
      await page.evaluate(async (family) => {
        const loaded = await document.fonts.load(
          `500 16px "${family}"`,
          "Ação, revisão",
        );
        return (
          loaded.length > 0 && loaded.every((font) => font.status === "loaded")
        );
      }, family),
    ).toBe(true);
  }
  expect(externalFonts).toEqual([]);
  expect(failedFonts).toEqual([]);
  const codeFamily = await page
    .getByLabel("Request console")
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(codeFamily).toContain("monospace");
  expect(codeFamily).not.toContain("Lexend");
  await page.screenshot({
    path: "test-results/fonts-light.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-font", "lexend");
  await page.getByRole("button", { name: "Customize appearance" }).click();
  await select.selectOption({ label: "System" });
  await expect(page.locator("html")).toHaveAttribute("data-font", "system");
  await page.getByRole("button", { name: /Reset/ }).click();
  await expect(select).toHaveValue("sans");
  await select.selectOption({ label: "Poppins" });
  await page
    .getByRole("dialog")
    .getByRole("radio", { name: "Dark", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/fonts-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(select).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("an unknown saved font falls back to Inter", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "reptest.theme.v1",
      JSON.stringify({ fontFamily: "missing-font" }),
    ),
  );
  await page.goto("/?view=monitoring");
  await expect(page.locator("html")).toHaveAttribute("data-font", "sans");
  await page.getByRole("button", { name: "Customize appearance" }).click();
  await expect(
    page.getByRole("combobox", { name: "Interface font" }),
  ).toHaveValue("sans");
});
