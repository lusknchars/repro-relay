# Repro Relay build brief

Build a Hermes agent that accepts a web-app complaint and an approved test URL, investigates the reported behavior, and creates an engineering ticket backed by observed evidence. The first customer is a small software team with a staging environment and recurring bug reports. This is a proposed implementation brief; no agent has been implemented or deployed.

The first completed job is a useful GitHub issue that an engineer accepts. The customer should be able to request this through a short chat message. Start with one application per installation, one dedicated test account, one browser adapter, and GitHub Issues. The [research report](./hermes-hackathon-research.md) contains the evidence, competing products, alternatives, event requirements, and adoption plan.

The [memory and agent architecture](./repro-relay-memory-architecture.md) extends this plan with verified case history, scoped retrieval, versioned repair packets, and consistent reporting across channels. Add these in stages. The initial agent prepares precise work for engineering or a repair agent; autonomous patch execution follows as a separate milestone.

| Included in the first release | Deferred |
| --- | --- |
| Text report, approved URL, expected result, optional screenshot | Full help-desk and inbox imports |
| Clarification of missing details | Automatic code fixes |
| Bounded browser investigation | Native mobile and cross-browser testing |
| Screenshots and an action log | A general testing platform |
| Persistent investigation record | A custom analytics dashboard |
| Reviewed GitHub issue creation with duplicate protection | Automatic customer communications |
| Installation guide and required usage reporting | Multiple issue trackers |

An example input is: "On staging, set the report range to last month and export. The button does nothing. It should download a CSV." If the report lacks an account or enough information to locate the flow, ask for the missing detail. Expected behavior is user-provided or confirmed against an approved specification. The model should not invent the acceptance criterion.

The workflow is sequential:

1. Receive the report and assign a stable request identifier.
2. Check the configured app, target URL, test account, and permitted actions.
3. Clarify the smallest missing detail that prevents investigation.
4. Run a bounded attempt and save observations as actions occur.
5. Classify the result as reproduced, not reproduced, blocked, or needs clarification.
6. Prepare a ticket with a source link, expected behavior, observed behavior, steps, and evidence.
7. Show the intended repository and ticket content for review.
8. Create the approved issue once and return its actual URL.

The output should distinguish the reported symptom from the agent's observation. For example: "Reported: export does nothing. Observed: after changing the date range, clicking Export produced no download during the configured wait. Reproduced in the named staging build with the test account." If a network error was actually captured, include it. Otherwise, do not infer a server error from the lack of a download.

Use Hermes for conversation and investigation planning. Put execution rules, duplicate handling, and state changes in small deterministic helpers. Keep the model responsible for interpreting a complaint, not for deciding whether a tool call really succeeded. Persist the workflow independently of the chat transcript so a restart can resume the same request.

| Record | Minimum fields |
| --- | --- |
| Request | ID, originating message ID, app ID, URL, complaint, expected behavior, creation time |
| Attempt | ID, request ID, target environment, browser, start/end time, result, blocker |
| Evidence | Attempt ID, artifact location, timestamp, action sequence, redaction status |
| Ticket draft | Request ID, destination repository, content, reviewer, approval state |
| Issue delivery | Request ID, destination, idempotency key, issue ID and URL, delivery state |

A repeated delivery attempt must reconcile against the stored issue and destination before creating anything. If the network fails after creation but before the response returns, look for the request marker on the destination. Keep ambiguous delivery in a recoverable state. Apply a lock per active request so duplicate chat events do not trigger simultaneous investigations.

Begin with a configurable cap of two investigation attempts and ten minutes total runtime. These are initial engineering limits, not claims about typical completion time. Authentication failures should stop immediately with a useful next action. Navigation restrictions and browser-side controls should enforce the permitted target, including redirects. Use a test account without production payment or destructive permissions.

Choose the browser adapter during the first technical spike. [Plow Latch](https://plow.co/latch) supports approved Mac and site access; verify which artifacts its current tools expose. [Playwright](https://playwright.dev/docs/trace-viewer) supports traces when used as the execution browser. A screenshot and action log are the baseline deliverables. Do not advertise Playwright traces from a Latch session or promise videos before confirming support.

Use the current [plow-agents](https://github.com/plow-pbc/plow-agents) setup path and a compatible pinned [Plow Hermes base image](https://github.com/plow-pbc/plow-hermes-agent). The old `agent-mgr` path is deprecated. The base initializes its own gateway, so the variant should follow its documented persona and skill mechanism. Confirm installation and runtime paths from the selected version before writing the Docker configuration.

Keep credentials out of the repository and image. Follow the [Agent Index client's](https://github.com/plow-pbc/agent-index-client) persistent installation identity and reporting flow. Check that a restarted installation continues reporting under the same identity and that the reporter reads the correct Hermes store. Describe public registration metadata and usage reporting during setup. Private bug artifacts should not become public Index stories automatically.

The meaningful acceptance checks are:

| Scenario | Expected result |
| --- | --- |
| Known bug in a controlled test app | Observed failure, evidence, and usable issue draft |
| Same workflow on a healthy build | Not reproduced, with the successful observation recorded |
| Missing or invalid test login | Blocked result, without invented screenshots or steps |
| Ambiguous expected behavior | Clarification before declaring a bug |
| Unexpected redirect or disallowed action | Execution stops at the configured boundary |
| Duplicate message or job restart | Same request resumes; no duplicate issue |
| Failure during issue creation | Delivery reconciles before any retry creates another issue |
| Interrupted investigation | Partial evidence survives; unfinished work is not reported complete |
| Sensitive value on the page | Evidence is withheld or redacted before sharing |
| Fresh installation and subsequent restart | First useful task works; reporting identity remains stable |

Build one working report-to-ticket path first. By the next day, exercise the failure cases above and let another person install it. Publish the agent and request verification as soon as that installation works. Keep the submission and verification dates aligned with the organizer's confirmed instructions, since the public event materials conflict on the final snapshot date.

For pilot evaluation, gather ten representative reports from at least three teams. Ask engineers whether each output lets them proceed without another clarification round. Initially seek six accepted investigations, including at least four independently reproduced bugs, and three users returning with another real report within seven days. These are proposed go/no-go thresholds. Report unsuccessful and blocked investigations in the denominator, and treat false reproduction claims as defects that stop expansion.

Compare against the same team's current workflow, including Jam, Bugster, existing tests, or a general-purpose agent. Measure active human effort, first-use setup time, agent cost per useful investigation, and repeat use. A completed run is not automatically a useful result.

The two-minute demo should show a complaint arriving, an observed reproduction, and the approved issue appearing in GitHub with its evidence. Then show an honest blocked result. Use real pilot work where disclosure is authorized; label any controlled fixture. Do not count demonstrations as independent adoption.

The first commitment needed is access to three prospective teams, recent reports, and an approved staging environment. If those cannot be obtained quickly, choose the alternative with accessible users rather than expanding this scope.
