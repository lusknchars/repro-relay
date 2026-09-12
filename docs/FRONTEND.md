# Frontend foundation

Frontend Lab is a reference collection, not an installable library. The initial app uses React, TypeScript, Vite, Tailwind, and shadcn Button and Badge primitives copied through the lab. The property inspector is newly implemented from native controls, informed by the lab's InspectorPanel composition. We do not copy the image-tool component or its reference artwork.

Reference paths in the Frontend Lab repository:
- `src/components/inspector-panel/InspectorPanel.tsx`: compact properties with native inputs.
- `src/components/ui/button.tsx`: reusable variants and keyboard focus.
- `src/components/ui/badge.tsx`: status and source-revision labels.
- `src/lib/utils.ts`: class merging helper.
- `README.md`: source provenance and portability conventions.

Source repository: https://github.com/lusknchars/frontend-lab
Upstream UI primitives: https://github.com/shadcn-ui/ui, MIT.

Use a quiet light workspace with a blue identity rail. Palette: canvas #f5f7fb, paper #ffffff, ink #182438, muted #58677c, accent #355cce, border #dfe5ee. Typography uses the system sans stack with tabular numerals for IDs and dates. No redistributable font asset is needed.

Desktop composition:
```
Workspace navigation | Case inbox | Selected case + evidence
                     |            | Properties / observation form
```

At mobile widths, navigation becomes a compact bar and panels stack. The selected case remains reachable without sideways scrolling. Motion is limited to user-triggered feedback. Source reference choices are documented here so future work reuses the same framework instead of selecting another template.

Button, Badge, and utility code carry the upstream MIT notice in THIRD_PARTY_NOTICES.md. No commercial Frontend Lab snippets, screenshots, or proprietary font files are included.

Reference commit: `1167099e04ca412f57fda657d28e19b0d8f933be`. Frontend Lab itself was read only. The new `ContextPanel` uses native build controls and role selection with an inspector beside evidence. No image-tool logic was imported.

Implementation references checked September 12, 2026: [Axum routing](https://docs.rs/axum/latest/axum/), [Tauri Vite integration](https://v2.tauri.app/start/frontend/vite/), and [native async save dialogs](https://docs.rs/rfd/latest/rfd/struct.AsyncFileDialog.html).
