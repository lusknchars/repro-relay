export const INTERFACE_FONTS = [
  { id: "sans", name: "Inter" },
  { id: "roboto", name: "Roboto" },
  { id: "open-sans", name: "Open Sans" },
  { id: "poppins", name: "Poppins" },
  { id: "dm-sans", name: "DM Sans" },
  { id: "montserrat", name: "Montserrat" },
  { id: "lato", name: "Lato" },
  { id: "mulish", name: "Mulish" },
  { id: "work-sans", name: "Work Sans" },
  { id: "ibm-plex-sans", name: "IBM Plex Sans" },
  { id: "ubuntu", name: "Ubuntu" },
  { id: "nunito", name: "Nunito" },
  { id: "outfit", name: "Outfit" },
  { id: "space-grotesk", name: "Space Grotesk" },
  { id: "lexend", name: "Lexend" },
  { id: "system", name: "System" },
] as const;

export type InterfaceFont = (typeof INTERFACE_FONTS)[number]["id"];

export function normalizeFont(value: unknown): InterfaceFont {
  return INTERFACE_FONTS.find((font) => font.id === value)?.id ?? "sans";
}

export function fontStack(value: InterfaceFont): string {
  const fallback =
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  const font = INTERFACE_FONTS.find((font) => font.id === value);
  return !font || font.id === "system"
    ? fallback
    : `"${font.name}", ${fallback}`;
}
