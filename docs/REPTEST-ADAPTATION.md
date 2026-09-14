# Supplied Reptest frontend and desktop

Current integration: the supplied visual shell remains the default, and its pages now use recorded backend data. See [the connected workspace milestone](LIVE-WORKSPACE.md). The source-fidelity notes below describe the original import, before this authorized backend integration.

The initial adaptation at `f4e4656` was rejected because it changed the supplied composition. The default web and macOS desktop frontend now uses the actual `reptest.zip` files in `web/reptest`, including its six screens, components, styles, theme provider and sample data. No Relay layout or CSS wraps these screens. The subsequent user-requested branding update replaces the RR placeholder, adds the favicon and supplies Hermes/Plow/Pi/Moonshot/Mem0 identity artwork; the original black/white PNGs and SVG are retained under `public/brand`.

Source archive SHA-256: `e82b16132b20d333228267a2b97e0faa272612780ca40b94da73494a7df5452d`. At initial import, the original source, HTML, package files, TypeScript configuration and Vite configuration were retained byte for byte. Later explicit branding edits replace the shell logo and HTML favicon and add Hermes/Plow/Pi/Moonshot/Mem0 artwork beside agent and connection identities, without restructuring the supplied screens. Generated TypeScript cache is excluded. Its own lockfile preserves the supplied React, icon and chart versions.

`vite.relay.config.ts` is the only added integration configuration. It emits separate JS/CSS assets into `web/dist` so Tauri can retain its existing content security policy. It proxies the local API for later integration but the imported screens do not call it. The original single-file Vite configuration remains available in the supplied directory.

## Run

- `make setup` installs both dependency trees.
- `npm run dev --prefix web` opens the supplied frontend at localhost:5178.
- `make desktop` starts the same frontend in a native Tauri development window.
- `make desktop-build` creates `target/debug/bundle/macos/Repro Relay.app`.
- `open 'target/debug/bundle/macos/Repro Relay.app'` opens the bundled app. The bundled prototype works without Vite, the API, or a model running.

The desktop uses the existing Tauri/Rust application, not a new SwiftUI Mac rewrite. The iPhone source remains separate in `apple/`.

## Prototype boundary

The visible `reptest · prototype` label and original capability tags are retained. Acme records, provider balances, investigating status, messages and test results are sample data. Appearance choices and local UI interactions work as supplied; account, authentication, messaging, approval, memory and connection examples are not live integrations. Some supplied controls are placeholders. No sample approval changes source code or starts Hermes.

The native repository and export commands remain implemented, but the supplied renderer does not invoke them. The old Workspace menu was removed because this renderer has no listeners for its commands. Native repository tools and backend actions need to be wired into the supplied design before claiming a functional production replacement.

## Existing backend interface

The previous interface is retained in `web/src` and can be opened explicitly with `npm run dev:legacy --prefix web -- --port 5179` while the API runs. Its source and working connection controls remain available for the next integration step. It is not the default client.

`npm run build:legacy --prefix web` emits `web/legacy-dist`. Existing workflow, guest, runner and compatibility tests explicitly target that interface. The guest test launcher uses an isolated working directory with that bundle, leaving the default `web/dist` untouched. `npm run test:reptest --prefix web` separately checks the supplied screens, appearance persistence, phone navigation, browser errors and absence of API writes. `make check` runs both sets; legacy tests do not prove backend integration in Reptest.
