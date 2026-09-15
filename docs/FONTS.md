# Interface fonts

Appearance → Font → Sans font offers Inter, Roboto, Open Sans, Poppins, DM Sans, Montserrat, Lato, Mulish, Work Sans, IBM Plex Sans, Ubuntu, Nunito, Outfit, Space Grotesk, Lexend and System. Selection applies immediately and is saved on the current device. Reset restores Inter. Existing `sans` and `system` preferences remain valid; unknown font IDs fall back to Inter.

Font files are bundled under `web/reptest/public/fonts/catalog`, so the browser and macOS app load them from Relay without contacting a font CDN. Only the selected family's required weights/subsets are requested. Latin and Latin Extended cover the English and Portuguese interface; other scripts use the system fallback. Normal weights 400, 500, 600 and 700 are included where the font provides them. Ubuntu supplies 400, 500 and 700. Italics and unsupported weights use browser synthesis. Code, logs and other monospace content retain their existing font.

The font catalog comes from [Fontsource's self-hosted packages](https://fontsource.org/docs/getting-started/introduction), all pinned to 5.3.0. `sources.json` records each package URL, verified tarball integrity, included weights and files. Each font directory includes its original license. Ubuntu uses the Ubuntu Font Licence; the other families use the SIL Open Font License. These licenses remain separate from Relay's MIT license.
