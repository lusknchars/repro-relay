# Skills library and teammate directory

Agents opens on Skills. The three existing Hermes workflow templates come from `/architectures`; selecting **Use skill** saves the focus through the existing version-checked update. The team's guidance and canvas positions are preserved. A confirming read supplies the active badge. If an update or confirming read fails, **Refresh skill selection** reconciles the server state before another change is allowed. Selection affects new investigations and does not launch a model or change an active run.

Runtime status, recorded activity and access information remain separate tabs. Search, card/list views and expandable skill descriptions keep the initial view focused on choosing a workflow. Only administrators see enabled selection controls.

Team opens on a people directory with the current profile, avatar initials, joined-member count, search, roles and selected teammate details. Selecting a teammate opens a profile alongside the one shared Hermes conversation. It does not create a private chat or send anything. **Work context** retains case search and attachment. No online status or last-message preview is invented.

`GET /team/directory` requires an authenticated current owner or viewer in this single-team installation. It returns up to 100 display IDs, names and roles, with a `has_more` flag. It excludes invitations, phones, credentials and other profile fields. The owner-only `/team` endpoint still governs invitation management. The native account bridge allows only GET for the directory.

Work uses the PaceUI `app-education-1` composition for expandable report, target/build, attempt, observation and review sections. The progress indicator measures which record sections contain information. A completed attempt does not certify a fix; local validation retains its attribution. The evidence inspector remains the destination for inspecting artifacts.
