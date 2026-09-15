# Third-party notices

## Relay transparent logo

The sidebar separately uses `web/reptest/public/brand/relay-sidebar-planet.png`, the user's supplied orbital-planet PNG, preserved without modification. Sign-in and the favicon retain the transparent SVG. No rights to the supplied artwork are granted by this project's MIT license.

The desktop bundle icons in `web/src-tauri/icons/icon.icns`, `icon.ico` and `icon.png` derive from the same orbital-planet PNG. The full artwork is fitted onto a square black canvas without cropping or stretching, then converted with Tauri's icon generator. The earlier `brand-source.svg` is retained as a legacy asset, not the source of these icons.

`web/reptest/public/brand/relay-logo-transparent.svg` is the user-supplied Relay logo. The supplied SVG artwork is preserved and used in phone sign-in and the browser favicon. This project's MIT license does not grant rights to the supplied artwork.

## Inter typeface

The current frontend bundles Inter regular, medium, semibold and bold through `@fontsource/inter`. Copyright 2016 The Inter Project Authors. Distributed under the SIL Open Font License 1.1; the full license ships in `web/reptest/public/fonts/Inter-LICENSE.txt`. Font files are served locally, without a font CDN request.

## Hermes image

`web/src/assets/hermes-logo.webp` was supplied by the user on September 12, 2026 for the Hermes investigator connection card. The image is preserved without modification. This project's MIT license does not grant rights to the supplied artwork.

## Plow logo

`web/src/assets/plow-logo.png` was supplied by the user on September 12, 2026 for the Plow connection card. The image is preserved without modification. This project's MIT license does not grant rights to the Plow brand asset.

Button, Badge, and class-merging utility in `web/src/components/ui` and `web/src/lib/utils.ts` were copied through Frontend Lab, commit `1167099e04ca412f57fda657d28e19b0d8f933be`, from its shadcn/ui primitives.

Source: https://github.com/shadcn-ui/ui

`web/src/components/ui/tooltip.tsx` and `kbd.tsx` are adapted from the official shadcn/ui Radix registry retrieved September 12, 2026:

- https://ui.shadcn.com/r/styles/new-york-v4/tooltip.json
- https://ui.shadcn.com/r/styles/new-york-v4/kbd.json

They use the same shadcn MIT notice below. Local adaptations use Repro Relay's theme tokens and the existing `radix-ui` dependency.

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## JetBrains Mono

JetBrains Mono regular, medium, and bold WOFF2 files are included in `web/public/fonts`.

Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono).
Licensed under the SIL Open Font License 1.1. The complete license is distributed alongside the fonts in `web/public/fonts/OFL.txt`.
Source revision: `19371302b95d218af43299bce79ddbddd0bc364d`.

## Motion and user-supplied button examples

`motion` 13.2.0 is used for the approval button's presence transitions under the MIT license. Copyright (c) 2024 Motion B.V. The complete dependency license remains in the installed package. `web/src/components/ui/approval-button.tsx` and `dot-expand-button.tsx` adapt the examples supplied by the user, replacing simulated request outcomes with application state and using the existing Lucide icons.

## GSAP interface transitions

The current frontend's `web/reptest/src/components/ui/gsap/fillable-button.tsx` adapts PaceUI's `@paceui/gsap-fillable-button`, retrieved through its MCP and registry on September 14, 2026: https://paceui.com/r/gsap-fillable-button.json. It retains the pointer-origin circular fill, with Relay theme tokens, forwarded refs, disabled/pending handling, reduced-motion support and lifecycle cleanup. PaceUI's applicable product terms remain in effect; retrieval without authentication does not relicense the component under this project's MIT notice. This frontend is excluded from the clean Agent Index package described in `docs/AGENT-INDEX-RELEASE.md`.

`gsap` 3.15.0 and `@gsap/react` 2.1.2 are package dependencies under the [GSAP Standard No Charge License](https://gsap.com/community/standard-license/). Their upstream license and copyright notices remain applicable; they are not relicensed under this project's MIT license. The app uses GSAP for interface transitions. It does not expose a visual animation editor.

## Tauri window state

`tauri-plugin-window-state` 2.4.1 is an upstream Tauri package used to persist window size, position, and maximized state. Its package license is Apache-2.0 OR MIT; upstream notices remain applicable.

## ReUI

`web/src/components/ui/timeline.tsx` and `web/src/components/ui/tabs.tsx` are adapted from https://github.com/keenthemes/reui, revision `8a2c701eaf95729f238274d5ce2555a5a8bd23e7`. Source paths and adaptations are documented in `docs/FRONTEND.md`.

MIT License

Copyright (c) 2025 Keenthemes Inc

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


## PaceUI Ultimate Dashboard

Authenticated source retrieved September 12, 2026 from `@paceui/ultimate-dashboard-template` via the official registry at https://paceui.com/r/ultimate-dashboard-template.json.

The adapted layout and AI dashboard live in `web/src/components/templates/ultimate-dashboard/`. Selected statistic, chart, and table blocks live in `web/src/components/blocks/dashboard/`. Source filenames and adaptations are recorded in `docs/PACEUI-MIGRATION.md`.

These files remain subject to the applicable PaceUI product license. They are not relicensed under Repro Relay's MIT license. The registry payload contained no separate license file. Consult the license attached to the purchaser's product and https://paceui.com/terms-of-service before public redistribution.

The accompanying shadcn Card, Input, Separator, Sheet, Sidebar, Skeleton, and Table components in `web/src/components/ui/`, and the mobile hook, use the shadcn MIT notice above. Local adaptations share the existing Radix controls and theme tokens.


## React Bits Pro ASCII Waves

`web/src/components/react-bits/ascii-waves.tsx` adapts the authenticated `@reactbits-starter/ascii-waves-tw` registry component retrieved September 12, 2026. The original shader and font-atlas generator are retained. The renderer is adapted to direct Three.js with limited frame rate, reduced-motion handling, visibility suspension, and resource cleanup.

Source: https://pro.reactbits.dev/api/r/starter/ascii-waves-tw.json
License: https://pro.reactbits.dev/license

The component remains subject to the React Bits Pro product license, not this project's MIT license. The license allows use and modification in an application but prohibits publishing component source, including modified source, in open source repositories. No public redistribution was performed.

Three.js and its TypeScript definitions are npm dependencies with their own upstream MIT notices.


## React Bits Pro Perspective Grid

`web/src/components/react-bits/perspective-grid.tsx` is adapted from the authenticated `@reactbits-starter/perspective-grid-tw` registry component retrieved September 12, 2026. The original shader and parameter defaults are retained. Local adaptations add reduced-motion and visibility handling, display-driven frame updates, ResizeObserver sizing, context-loss handling, and GPU disposal. The shared Connections layout supplies the user's exact visual values and fills the background height.

Source: https://pro.reactbits.dev/api/r/starter/perspective-grid-tw.json
Docs: https://pro.reactbits.dev/docs/components/perspective-grid
License: https://pro.reactbits.dev/license

This component retains its React Bits Pro product license. As with ASCII Waves, do not publish its source in an open source repository or relicense it under the project's MIT license. No public redistribution was performed.


## User-supplied reptest prototype

The user provided `reptest.zip` as a frontend adaptation reference on September 14, 2026. Its shell, appearance settings and semantic colors informed the implementation in `web/src/components/reptest`, `web/src/reptest.css` and the existing PaceUI layouts. The archive describes itself as a PaceUI/shadcn recomposition. Existing PaceUI licensing and notices remain applicable. Sample business records and the archive's dependency tree were not imported. See `docs/REPTEST-ADAPTATION.md` for provenance and the implementation map.

## User-supplied Reptest frontend

`web/reptest` contains the actual user-supplied archive, replacing the earlier visual adaptation as the default frontend. Original source and package lockfile are retained. The archive README describes its PaceUI/shadcn reconstruction. Import for this requested local application does not establish a broader redistribution license. See `docs/REPTEST-ADAPTATION.md` for source hash and integration boundaries.

## Bundled interface fonts

`web/reptest/public/fonts/catalog` contains Fontsource 5.3.0 WOFF2 distributions for Inter, Roboto, Open Sans, Poppins, DM Sans, Montserrat, Lato, Mulish, Work Sans, IBM Plex Sans, Ubuntu, Nunito, Outfit, Space Grotesk and Lexend. Each family includes its original license. Ubuntu is under UFL-1.0; the other families are under OFL-1.1. These fonts are not relicensed under Relay's MIT license. Package provenance and integrity are recorded in `sources.json`; see `docs/FONTS.md` for weights, subsets and use.

## Repro Relay brand mark

The current orbital logo was supplied by the user as `repo-relay-icon.svg` and `repo-relay-icon-transparent.svg`, preserved unchanged in `web/reptest/public/brand`. Web and desktop derivatives use the transparent source with a tighter display canvas. The two legacy theme PNG paths now carry this full-color artwork. `scripts/generate-brand-icons.mjs` regenerates the favicon and native icons with Tauri. See `docs/BRANDING.md`.

The supplied Hermes WebP and previously supplied Plow PNG are also copied unchanged into `web/reptest/public/brand`, for the default web and desktop interface. `IntegrationLogo` preserves their aspect ratios and original backgrounds.

The user-supplied `pi-logo-on-dark.svg` and `moonshot.png` are copied unchanged as `pi-logo.svg` and `moonshot-logo.png` in the same brand directory. Their display tiles supply contrast without recoloring the original artwork.

The supplied `light.svg` is the Mem0 wordmark, stored unchanged as `mem0-logo.svg`. It is displayed on a light tile with a text alternative where it replaces the visible name.

## PaceUI Education 1

`web/reptest/src/components/work-record-checklist.tsx` adapts the header, progress indicator, collapsible numbered modules and status icons from PaceUI `app-education-1`, retrieved with its official MCP `add-block` tool and installed from https://paceui.com/r/app-education-1.json on September 14, 2026. Course fixtures were replaced with Relay case data. Record coverage describes available records, not verification or fix completion. PaceUI's product terms remain applicable; this adaptation is not relicensed by the repository's MIT notice. The frontend remains outside the clean Agent Index package.

## Optional private Glowing Ridges

Locally opted-in desktop builds use `@reactbits-starter/glowing-ridges-tw` from the authenticated React Bits Pro registry. Its source is stored only in Git-ignored `web/reptest/src/private/` and is not licensed under Repro Relay's MIT license. See https://pro.reactbits.dev/license. Normal builds exclude this component. React Three Fiber, Three.js and Motion retain their own package licenses.
