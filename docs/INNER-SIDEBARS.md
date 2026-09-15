# Page-specific inner sidebars

Architecture, Agents and Knowledge use their own navigation inside the shell's existing collapsible sidebar. The pages own the controls and data; a React portal places them in the shell without extra API reads or a second source of state. Other pages keep their existing navigation.

- Architecture combines repository/workflow navigation, searchable nodes, template selection, source details and saved research links. The former component-library column moves into this sidebar, leaving more width for the canvas. Switching views does not apply a workflow. The selected view survives refresh; collapsing the sidebar preserves unsaved guidance and its node search while the page remains open.
- Agents keeps Skills, Runtime, Activity and Access visible beside the content. Counts come from loaded templates and recorded Hermes runs; local validations are excluded from the run count. The active skill and connection links use existing settings and permissions. Navigation does not start an agent or apply a skill.
- Knowledge groups current reviewed observations by source report, with report/project search and counts. Selecting a source filters the main list and persists in the URL. Each observation links back to its source report. The existing text search and revocation controls remain; private notes are not added to shared knowledge.

The sidebar uses the existing open/closed preference and header toggle. Closing returns focus to that toggle. On smaller screens the open sidebar stacks above the page with a scrollable body. Loading, missing data, source failures and empty search results remain distinct.

Browser checks cover draft preservation, node selection, canvas width, section/source persistence, narrow-screen navigation, focus restoration and unavailable knowledge sources. Knowledge fixtures do not publish memories or invoke an agent.
