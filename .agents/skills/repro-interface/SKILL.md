---
name: repro-interface
description: Build Repro Relay screens using its Frontend Lab reference decisions and accessible controls.
---

# Repro Interface

Read `../../../docs/FRONTEND.md` before changing visual structure or adding dependencies.

Use the case inbox, evidence workspace, and compact property inspector as the primary composition. Show facts and actions near the case they affect. Distinguish a recorded observation, reviewed memory, and an exported packet in labels and status.

Reuse the local Button and form conventions. Frontend Lab is a reference collection, not a package dependency. Check source origin and redistribution rights before copying a component; restricted commercial snippets and system fonts stay outside the public MIT project.

All visible actions must work or explain the specific missing connection. Preserve loading, empty, validation-error, and disconnected states. Dialogs need focus management and a keyboard exit. At narrow widths, stack the inbox and selected case while retaining access to the actions.

Check the real local app in the available browser: create a case, record an observation, publish memory, retrieve it from another case, and export the handoff. Verify persistence after reload and no horizontal overflow on mobile.
