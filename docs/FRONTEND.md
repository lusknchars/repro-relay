# Frontend design

Repro Relay is an engineering workbench for preserving evidence and preparing agent handoffs. The connected report, evidence, memory, and handoff path is the central visual idea. The public landing page includes an interactive, explicitly synthetic build-change example. The workspace path reflects actual case state and opens the relevant detail view.

## Foundation and references

React, TypeScript, Vite, Tailwind, and locally owned shadcn Button/Badge primitives remain the framework. Frontend Lab is a reference collection, not an installable library. The property inspector uses native controls informed by the lab's InspectorPanel composition.

Frontend Lab: https://github.com/lusknchars/frontend-lab, reference commit `1167099e04ca412f57fda657d28e19b0d8f933be`.

- `src/components/inspector-panel/InspectorPanel.tsx`: compact properties and native inputs.
- `src/components/ui/button.tsx`: reusable variants and keyboard focus.
- `src/components/ui/badge.tsx`: status and source-revision labels.
- `src/lib/utils.ts`: class merging.
- `README.md`: source provenance and portability conventions.

The September 12 request also named https://theui.com. Fetching that exact address returned a page titled “Young Hollywood | The Maybourne Beverly Hills,” not a component catalog. Its component reference remains unresolved. No assets or code were imported from that site. Continue with the existing foundation until the user supplies the intended address.

## Visual system

Preserve the original blue `#355cce` and white branch mark. The logo wordmark retains its sans-serif lettering. The rest of the interface uses locally hosted JetBrains Mono regular, medium, and bold. The fonts are from the [official JetBrains repository](https://github.com/JetBrains/JetBrainsMono), revision `19371302b95d218af43299bce79ddbddd0bc364d`. Their SIL Open Font License is bundled in `web/public/fonts/OFL.txt`.

Light palette: rail `#172e69`, canvas `#eef2f8`, paper `#ffffff`, ink `#1c2d4a`, muted `#5c6c83`. Dark mode uses slate-blue surfaces and the same brand mark. Semantic tokens in `web/src/design.css` define both palettes. Green and amber accompany named success and outdated states; color is not the sole indication.

Use 12–14px body text, compact metadata, 20–22px case headings, and larger landing typography. Keep prose left aligned. Use borders to separate evidence and execution controls, not a grid of decorative metric cards.

Desktop:

```text
Blue navigation | Report inbox | Case title and evidence path
                |              | Evidence / Context / Packet / Activity
                |              | Evidence content + execution inspector
```

On mobile, the selected case and report list switch between focused views. “All reports” returns to the list. Navigation remains available at the top. The theme control remembers an explicit preference and otherwise initializes from the device setting.

## Interaction and validation

- The landing example lets a visitor change a sample build, see the outdated-context state, and reset it. It does not call an agent or claim real verification.
- Detail tabs support arrow keys, Home, End, and named tab panels.
- Native dialogs trap focus, close with Escape, and return focus to their trigger.
- A single document entrance introduces the landing preview. Short transitions respond to tab, dialog, feedback, and build-example actions. There are no looping animations. Reduced motion disables transitions and animations.
- Keep loading, empty, error, disconnected, and stale states actionable and readable in both themes.
- Run `make check` for the real workflow and guest tests. Guest coverage includes theme persistence, the interactive example, keyboard focus, reduced motion, and mobile inbox navigation. Inspect screenshots of light, dark, and mobile views.

Button/Badge notices and font attribution are in `THIRD_PARTY_NOTICES.md`. No proprietary component code or reference artwork is included.
