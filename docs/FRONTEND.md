# Frontend design

Repro Relay uses the authenticated `@paceui/ultimate-dashboard-template` source as its only dashboard template. The user's selection replaces the former custom blue rail and landing preview. See [the migration record](PACEUI-MIGRATION.md) for provenance and installation.

## Shared application

Web and Tauri render the same React, TypeScript, Vite, Tailwind application. PaceUI supplies the sidebar, sticky top bar, page title, footer, AI dashboard composition, statistic cards, chart cards, and table layout. Their source is in `web/src/components/templates/ultimate-dashboard` and `web/src/components/blocks/dashboard`.

The seven views are Overview, Autonomous work, Case inbox, Agent controls, Project memory, Handoffs, and Connections. Navigation persists in the URL. Case detail opens from the table; All reports returns to the list. On mobile the template sidebar opens in a drawer.

Autonomous work replaces the prompt-driven Sessions screen on the existing `view=sessions` route. Desktop shows automatic audit history, evidence and proposal decisions, and repository monitoring. Mobile switches between Activity, Review, and Monitor. No session title, project form, first prompt, continuation form, or direction composer remains. Earlier saved notes are preserved in the API and shown as the latest 40 previews under Earlier notes.

The local context harness collects tracked instruction snapshots automatically. The view shows real audits, duplicate-content proposals, version-bound approve/decline actions, pause/resume, and measured evaluation receipts. No duplicate files means no proposal. A disconnected harness never appears active. Evaluation builds a lossless storage representation without editing source or calling a model; its byte counts are not labeled token savings. History and decisions persist in PostgreSQL. The shared web/Tauri UI polls every five seconds; the separate harness runs every fifteen seconds. See [the harness contract](../integrations/context-harness/README.md).

Overview values come from stored cases, observations, reviewed memories, and handoff snapshots. The activity chart groups reports and observations by UTC date over fourteen days. Agent controls use the existing Hermes coordinator with one active investigation. Phone intake, owner delivery, and Latch actions remain labeled as unconnected.

Agent controls now opens a three-column investigation workspace inspired by the supplied context-rescue reference: searchable cases, the saved result with evidence and reviews, and the exact next-run context with runtime controls. It remains inside PaceUI and uses existing shadcn buttons and Relay theme tokens. Narrow layouts stack the columns. The view separates human observations, coordinator events, proposals, and review decisions; none is labeled as an automated browser receipt. Reviewed corrections can be included in a follow-up after previewing its server-generated context. Saved run selection survives reload; unsaved drafts and pending retries last only while the workspace is mounted.

The evidence section reads paginated typed findings, journal events and artifacts from the backend. Opening a stored log shows its exact text, SHA-256, byte length and environment. Revoked content is unavailable. Local validation records display the supplied inspector's name and command context, separately from Hermes execution. Configuration, intake, delivery, and repair APIs are currently backend contracts; their full management views remain to be built inside the selected template.

## Components and appearance

The Plow Chat + Latch connection card uses the user-supplied `web/src/assets/plow-logo.png` in both web and desktop. Its original lime mark and dark background are preserved. The adjacent card title labels the image, so it has an empty alt attribute to avoid duplicate screen-reader announcements.

The Hermes investigator connection card and the overview's Investigator control card use the user-supplied `web/src/assets/hermes-logo.webp`, also unchanged and labeled by its adjacent title. A white image surface keeps the black artwork visible in both themes.

The CLI installed the selected template and its shadcn dependencies. Unused sales, crypto, customer, hospital, and sample app files were removed. The migration adds Recharts; unused registry dependencies were removed. Existing Button, Badge, Tooltip, Kbd, Radix tabs, and event timeline retain their APIs and licenses. They are controls inside the selected template, not additional dashboard templates.

The neutral white/zinc sidebar, cards, typography, spacing, and mobile drawer follow PaceUI. Repro Relay's blue primary color identifies actions and its branch mark. System sans-serif is the body font; locally hosted JetBrains Mono is used for code and identifiers. Light/dark semantic tokens live in `web/src/styles.css`. `design.css` styles Relay's case content, dialogs, context inspector, and startup view within the template.

The sidebar includes the authenticated `@reactbits-starter/ascii-waves-tw` component from React Bits Pro. Its original wave shader and glyph atlas are retained in `web/src/components/react-bits/ascii-waves.tsx`. A direct Three.js renderer replaces React Three Fiber because Fiber 9.7 excludes this application's React 19.3 from its supported peer range. No React downgrade or ignored peer conflict is required.

The effect is decorative, lazy-loaded, clipped to the sidebar, and excluded from pointer events and the accessibility tree. Theme colors and a vertical mask preserve navigation contrast. Rendering uses device pixel ratio 1, no antialiasing, and at most 20 frames per second. Reduced motion shows a static frame; hidden documents and offscreen sidebars pause rendering. Closing the sidebar unmounts the renderer and disposes GPU resources. A static character texture appears when WebGL is unavailable or its context is lost. PaceUI remains the dashboard template.

Registry access uses `REACTBITS_LICENSE_KEY` in ignored `web/.env.local`; it is not a browser environment variable. Source is governed by the [React Bits Pro license](https://pro.reactbits.dev/license), which prohibits publishing component source in open source repositories. Keep the licensed source private.

Source notices are in `THIRD_PARTY_NOTICES.md`. Frontend Lab supplied the existing shadcn Button/Badge and utility at revision `1167099e04ca412f57fda657d28e19b0d8f933be`. Existing ReUI timeline and Radix tabs were adapted from revision `8a2c701eaf95729f238274d5ce2555a5a8bd23e7`. PaceUI's product license applies to its template source; it is not relicensed by the project's MIT notice.

## Configuration background

The Connections page uses authenticated `@reactbits-starter/perspective-grid-tw` behind the existing PaceUI configuration cards. The shared layout keeps the user's grid configuration: `speed={1}`, `gridScale={2.7}`, `lineThickness={0.1}`, `fadeSmoothness={0.9500000000000001}`, `perspective={-30}`, `gridLength={13}`, and `curve={2.3000000000000003}`. Only `height="100%"` is added to fill the page background. The user subsequently requested matching the sidebar colors. Both effects now share `--effect-blue` and `--effect-opacity`, with the same Three.js color conversion. The grid background and bottom fade use `--sidebar`. Theme changes update the shader immediately, including in reduced-motion mode. ASCII Waves remains in the sidebar.

The installed component already uses Three.js directly. Its shader is preserved. The grid renders on every `requestAnimationFrame` callback, allowing 120/144+ Hz when the display, browser, and GPU permit it. Elapsed-time updates keep movement speed consistent across refresh rates. Reduced motion freezes the frame; hidden/offscreen views pause rendering. ResizeObserver sizing and context-loss handling remain active. GPU resources are disposed when leaving Connections. When WebGL is unavailable, the dark background and usable configuration controls remain. The decorative layer cannot capture pointer events, and cards and heading retain opaque surfaces. The React Bits Pro product license applies. Rubber Fluid and its blue background were removed.

## Interaction and validation

Dialogs focus the first field, close with Escape, and restore trigger focus. Case tabs support arrow keys. Search and native Workspace commands share the existing command dispatcher. The desktop startup screen explains the separate API/database requirement and offers retry.

Navigation exposes the current page, the sidebar trigger exposes its expanded state, and the skip destination accepts focus. Mobile sidebar navigation and its visible close button have 44-pixel targets. Investigation controls use labeled fields, visible keyboard focus, live status announcements, and 44-pixel targets. The isolated compatibility suite checks both themes at 320 pixels, dialog focus restoration, drawer dismissal, and JavaScript errors. Windows CI runs it in Microsoft Edge; those results must be recorded separately from local Chromium checks.

GSAP 3.15.0 with `@gsap/react` 2.1.2 animates case panels, investigation state changes, confirmations, and desktop connection states with scoped 220ms opacity/transform transitions. Buttons have a 120ms press transition. Reduced motion disables both GSAP and CSS effects. Chart entry animations are disabled.

Run `make check` and `make desktop-build` after workflow changes. Browser coverage includes report capture, observations, memory, handoff freshness, URL persistence, guest isolation, theme persistence, keyboard commands, mobile layout, and fixture investigation controls. Screenshot checks cover the actual dashboard in both themes and mobile case detail. Browser tests do not establish native save-dialog behavior or live Hermes/Latch delivery.
