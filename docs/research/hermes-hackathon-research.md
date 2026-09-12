# Team products for the Hermes Hackathon

The best initial project for a small software team is **Repro Relay**, a Hermes agent that turns a reported web-app problem into an engineering ticket backed by an actual reproduction attempt. A teammate supplies the complaint, an approved test URL, and the expected behavior. The agent investigates, records what happened, asks for missing information when necessary, and prepares a ticket another person can act on.

This recommendation is conditional on access to a few software teams with real bugs to investigate. If the available pilot users are agencies or service businesses, **Client Chase**, which collects and checks missing client materials, becomes the better choice. Access to recurring work should decide between these two. Neither opportunity is an empty market.

The analysis assumes one to three builders, work beginning September 11, 2026, and a useful release before September 16. These are planning assumptions, not confirmed team capacity. Product names are working labels, with no trademark or domain availability check. The proposed scope, milestones, acceptance thresholds, and pricing experiments below are recommendations rather than measured results.

The event's current description requires a working Hermes agent, public MIT-licensed code, installation through the Agent Index, verification, and reporting through the AI Worth Using client. Plow Latch and the Plow chat plugin are encouraged. The description names September 16 for submission and September 23 at 1 p.m. Pacific for the ranking snapshot, based on installs and token usage.[^1]

The same event's calendar metadata ends September 22. An older launch listing also says September 22 and describes a different winner-selection process.[^2] The current description is the stronger planning source, but the organizer should settle this conflict. September 23 at 1 p.m. Pacific is 5 p.m. in São Paulo. The submission deadline has no stated hour in the description.

The Agent Index says verification and one-click deployment begin September 14, with manual deployment by the Plow team beforehand. Verification means the hosts install and run the agent.[^3] Build a clean installation early enough to leave time for that review.

| Decision to settle with the organizer | Why it changes the plan |
| --- | --- |
| Final snapshot date and submission cutoff time | Determines the last useful day for onboarding and repairs |
| How installs and tokens are combined | A shared team agent may serve many people through one installation |
| Which dates count toward ranking | Avoids assuming an older listing's usage window still applies |
| Verification turnaround and packaging expectations | Determines how early the first submission must be ready |
| Plow activation, model access, and usage costs for testers | Determines whether pilot installation is affordable and practical |

These are unresolved operational questions. None requires delaying interviews or a local prototype. The complete live leaderboard did not populate in the accessible page text, so this report makes no claims about current leaders, entry counts, or the absence of similar hackathon submissions.

The event creates an unusual product constraint. A project needs to be useful quickly enough that people will install it and return during a short window. A sophisticated quarterly workflow has fewer chances to prove that than a task occurring several times a week. A central team deployment may create substantial value without creating many independent installs, so product usage and leaderboard metrics should be measured separately.

The research supports several real problems, but it does not establish demand for a particular new product. The most relevant evidence is below.

| Evidence | What it supports | Limits |
| --- | --- | --- |
| Atlassian's 2025 survey of 12,000 knowledge workers and 200 executives reports that roughly a quarter of work time goes into finding answers.[^4] | Teams pay a substantial coordination cost | Vendor-sponsored, self-reported, broad population; not a measure of startup willingness to pay |
| A study of 484 Microsoft developers links larger gaps between actual and preferred workweeks with lower reported productivity and satisfaction.[^5] | Investigate frustrating work around coding, as well as coding itself | One company and correlational results |
| A July 2026 bug-report study examined 433 SWE-bench Verified issues attempted by 87 repair agents, plus controlled ablations on SWE-bench Pro.[^6] | Concrete reproduction information and explicit expected behavior deserve priority | Benchmark findings do not establish reliability on customer web apps |
| Content Snare's paying-customer survey reports substantial time spent collecting information and fewer stalled projects after adoption.[^7] | Missing client materials can be commercially painful | Self-selected respondents, retrospective estimates, vendor publication |
| Linear and Pylon already connect customer requests to engineering work and notify support when linked issues change.[^8][^9][^10] | This handoff is important enough for established products to support | Existing coverage weakens a generic notification product |
| Fellow and Zapier already capture and route meeting follow-ups.[^11][^12] | Action-item administration is an established use case | Extraction and reminders alone offer little differentiation |

One frequently repeated statistic needs care. Microsoft's 2025 report describes 275 daily interruptions, but its methodology bases that figure on the top 20% of users by incoming ping volume and a 24-hour day. It is not an average for every worker. The underlying telemetry also excludes EU and education tenants.[^13] The useful product implication is to minimize additional notifications and ask for a person's attention only when it moves work forward.

The bug-report paper provides a useful design distinction. It associates executable reproduction information with repair success and finds that missing expected behavior can lead agents toward the wrong interpretation. Its authors explicitly caution that the observational analysis cannot establish causation, and that open-source benchmarks may not generalize to industrial reports.[^6] Repro Relay should therefore demonstrate what it actually observed and retain uncertainty. It should never turn a plausible explanation into a claimed reproduction.

Content Snare provides a different kind of demand signal. Its survey says about one in ten paying customers responded, and its published medians and percentage improvements summarize different aspects of the results.[^7] Those numbers should not become a forecast for a new agent. A separate case study with Kickstart Web Design describes problems collecting website content and the value of centralizing it.[^14] Together they justify interviewing agencies about this work, while also showing that a capable incumbent already exists.

Four projects merit consideration. The ordering below assumes access to software teams; it should change if actual pilot access differs.

| Project | Recurring job | First buyer or champion | Hackathon assessment |
| --- | --- | --- | --- |
| Repro Relay | Investigate a reported web bug and hand engineering evidence | Engineering lead, technical support lead, agency developer | Best initial software-team experiment; browser reliability is the main risk |
| Client Chase | Locate, check, and collect missing project materials | Agency owner or project manager | Strong alternative if service-business pilots are available |
| ShipReply | Confirm a fix is deployed and prepare a response to affected customers | Founder handling support or support lead | Useful narrow workflow, but linking and notifications are already crowded |
| Decision Follow-through | Turn a specific commitment into an owned task and check completion | Team lead or project manager | Straightforward initial build; highest risk of duplicating existing tools |

**Repro Relay** addresses the point where support, product, and engineering disagree about what happened. A report such as "export stops working after I change the date filter" often leaves the next person to identify the account state, expected result, and steps. The product accepts this report, checks that the target is authorized, and attempts the workflow in a test environment. It produces observed steps, expected versus actual behavior, evidence, and a clear result: reproduced, not reproduced, blocked, or needs clarification.

An initial customer would be a small B2B SaaS team or development agency with a staging environment and several browser bug reports each week. The buyer cares about the developer time spent reconstructing reports. The daily user may be a support person or product manager who does not want to operate developer tools.

For example, a teammate sends: "On staging, changing the range to last month makes the export button stop working. It should download a CSV." The agent verifies the test account and attempts the exact flow. It returns a failure screenshot and action log, then offers a GitHub issue containing those observations. If it cannot sign in, it records an authentication blocker. If the export succeeds, it asks what differs from the reporter's environment rather than labeling the complaint false.

The first release should support one browser, one approved app per install, and GitHub Issues. It should handle text and an optional screenshot. An internal engineering ticket is the completed deliverable. Automatically fixing code, searching all support channels, reproducing native mobile issues, and notifying customers can wait. A later command can rerun the same acceptance check against a fix, provided the original reproduction is already dependable.

Competition is substantial. Jam captures recordings, technical context, and customer reports, and now exposes MCP, CLI, and webhook workflows for agents.[^15] Bugster runs browser tests from natural-language instructions and produces reports and recordings when tests fail.[^16] The proposal therefore cannot claim that automatic browser testing, evidence capture, or agent-readable bug reports are new.

The hypothesis worth testing is narrower: a ready-to-install Hermes workflow can take a messy incoming complaint through clarification, an observed attempt, and a useful internal ticket with little setup. Jam could become an input integration instead of something to replace. A pilot should compare this workflow against the team's current tools and an ordinary browser-capable agent. If users gain little from the packaged workflow, the project has not earned a separate product.

The main failure modes are inaccessible accounts, missing data, inconsistent staging environments, and unreliable conclusions. Limit initial support to workflows the team can reproduce with a dedicated test account. Track evidence quality separately from whether the agent manages to navigate the UI. A result marked blocked can be accurate; it is still less valuable than a completed investigation and should not inflate the success rate.

**Client Chase** addresses projects waiting for information scattered across messages and shared folders. A project manager selects a checklist for one client deliverable. The agent examines the permitted conversation and folder, associates received material with each requirement, identifies omissions, and prepares a specific request. After the manager approves it, the agent follows the response, saves the accepted material, and updates the checklist.

Start with website agencies collecting approved copy, logos, and images. This is easier to inspect than a broad document-compliance workflow. For example, "the client sent the logo" is insufficient if the deliverable requires a transparent image above a defined resolution. A useful agent checks that requirement, names the missing item, and attaches the accepted file to the right project folder.

The first release needs one message intake route, one storage destination, and one checklist template. A forwarded message or uploaded export can establish initial value without importing an entire inbox. Continuous email monitoring should only be added once the specific connector and permission flow work for pilot users. The agent should retain original files and source links, and leave editorial approval with the manager.

Content Snare already offers structured requests, reminders, approvals, and document collection.[^7][^14] The proposed advantage is helping clients and teams finish an existing conversation without migrating all work into a portal, combined with checking whether the received material satisfies the request. This is a hypothesis about workflow preference, not a proven capability gap. If clients happily use an existing portal, rebuilding that portal is a poor use of the event.

This idea has a strong commercial story when a team can point to delayed launches or repeatedly interrupted staff. It has a weaker hackathon story if the target clients respond only once every few weeks. Select pilot agencies with active projects and materials due during the competition. Measure accepted items and fewer manual follow-ups, not messages sent.

**ShipReply** starts after engineering believes a customer issue is fixed. It links a reported problem to an engineering issue and a target environment, checks available release evidence, prepares a relevant response, and sends it only after approval. It then records the delivery against the original report. A useful result tells a customer what changed, where it is available, and whether they need to do anything.

The critical distinction is between an issue being closed, code being merged, and a change reaching the customer's environment. GitHub exposes deployments with commit and environment information, and separate deployment statuses.[^17] These can support a configured check, but a success status does not prove that the reported user workflow now works. Feature flags and staged rollouts can also make release evidence incomplete. Keep the deployment check explicit and allow an authorized person to confirm availability where the pipeline lacks the necessary metadata.

The MVP should accept an explicit customer-thread-to-issue link, monitor a single repository and environment, and prepare an approved reply. Automatic matching of old complaints, multiple help desks, and customer-specific rollout inference should wait. This keeps the task understandable and avoids associating the wrong customer with a fix.

Linear's Intercom integration already creates issues with AI, posts internal notes, and can reopen conversations when an issue completes or is canceled.[^9] Pylon also updates linked support work when Linear issues complete.[^10] Canny offers feedback tracking and completion notifications.[^18] A generic "tell the customer when the issue closes" agent has weak differentiation. The more defensible experiment is deployment-aware verification and a response grounded in the customer's original problem. Even that requires customer validation before expanding.

**Decision Follow-through** accepts a forwarded commitment such as "Ana will deliver the revised proposal by Thursday." It asks for confirmation when ownership or the deadline is ambiguous, creates the agreed task, and checks an explicit completion source. A final update goes back to the originating thread. It should handle a narrow process, such as client proposal approval, rather than inferring every commitment in every team conversation.

A team lead is a plausible champion, but the product must prove it reduces manual chasing without annoying teammates. Fellow already extracts action items, assigns them, sends meeting follow-ups, and connects them to task systems. Zapier supplies workflows for capturing and routing follow-up actions.[^11][^12] An additional task list or reminder bot will be hard to justify. The experiment would need a concrete completion check, such as an approved document in a specific folder, and enough repeated use to show that the check is reliable.

This is the fallback for a team with excellent access to project managers and limited browser-automation experience. Its implementation may be simpler, but its product differentiation is weaker. Explicitly forwarding a commitment also creates a cleaner starting point than silently monitoring every conversation.

For Repro Relay, the proposed architecture is deliberately small. Hermes handles dialogue, interpretation, and investigation planning. A browser adapter executes permitted actions and records observations. A small persistent store tracks the report, attempts, and issue creation. The GitHub connector creates the final ticket. A separate reporter accounts for the agent's usage.

| Component | Responsibility | Boundary |
| --- | --- | --- |
| Hermes runtime and packaged workflow | Ask for missing details and plan the investigation | The model's interpretation is not execution evidence |
| Browser adapter | Perform approved test actions and collect observations | Restrict targets and allowed actions to the configured test environment |
| Evidence store | Keep screenshots, action results, target URL, and timestamps | Exclude credentials and unrelated customer data |
| Persistent run record | Resume interrupted work and recognize duplicate requests | Repeating a job must not create another issue |
| GitHub adapter | Search for a linked report and create the approved ticket | Return the actual issue URL only after successful creation |
| Agent Index reporter | Report usage through the required client | Keep public metadata separate from private investigation artifacts |

Hermes documents extensible tools, portable skills, and scheduled jobs.[^19] Scheduling can support a later fix-check workflow; it is unnecessary for every interaction. The first release should be driven by actual reports, with bounded attempts and an explicit stop result.

Plow Latch is suitable for approved access to a Mac and authenticated sites. Its documented credential flow fills passwords without exposing them to the model.[^20] That does not mean all page contents or tool results remain local. This proposal should describe precisely what evidence it stores and what the configured model receives. Latch's current evidence-export capabilities must be checked before promising browser network traces or video through that adapter.

A Playwright adapter is an alternative for controlled test environments. Playwright supports trace capture and a viewer for recorded runs.[^21] Do not assume a trace from one browser system can be exported by the other. Select and test one adapter on the first day. If Latch is used for navigation, a screenshot and structured action log are sufficient initial evidence; a Playwright trace is an optional deliverable only when it actually exists.

The installation documentation has an important migration. The older `agent-mgr` repository is deprecated in favor of `plow-agents`.[^22] The current path uses line-scoped credentials and a repository-owned Compose configuration.[^23] The Plow Hermes base describes variant images with a persona and skills, and an initialization-managed gateway.[^24] Pin compatible versions and test on a fresh machine. Do not copy an older setup guide's runtime paths or gateway-start commands into the new layout.

The Agent Index client documents token-count reporting, public registration metadata, optional published stories, and a persistent installation identity. It says reporting does not transmit prompts or task text.[^25] Test registration, normal reporting, and restart behavior before inviting pilots. A shared agent's users and independent installations are different quantities; the organizer needs to clarify how that affects this event.

A technical spike should answer three questions before substantial interface work: can a fresh user install and activate the agent, can it investigate a representative test flow, and can the required usage reporting run against the chosen runtime? Failure on the first or third question threatens eligibility regardless of product quality. Failure on the second suggests reducing browser scope or choosing Client Chase if accessible pilots support that choice.

| Date | Proposed outcome | Evidence of completion |
| --- | --- | --- |
| September 11 | Choose the workflow and recruit initial pilots | Three prospective users offer current examples; installation and reporting spike runs |
| September 12 | Finish one investigation end to end | A real test report produces evidence and an approved GitHub issue |
| September 13 | Handle the common failure paths | Missing context, failed login, unsuccessful reproduction, and retries behave honestly |
| September 14 | Publish the installable project and request verification | Public MIT project, working installation guide, and verification request |
| September 15 | Observe people installing and using it | Three independent pilot installations and recorded setup problems |
| September 16 | Submit and stabilize | Submission completed before the organizer-confirmed cutoff |
| September 17 onward | Improve repeat usefulness | Pilot users return with new work; fixes target observed failures |

This schedule is ambitious for a solo builder. Preserve installation, truthful evidence, and a completed handoff. Cut a dashboard, additional integrations, automated repairs, and broad discovery features first. If the browser investigation is not useful by September 12, make a deliberate scope decision instead of hiding the missing behavior behind a polished demo.

Pilot recruitment should be specific. Ask a founder or engineering lead for one recent report that required back-and-forth and permission to investigate it in staging. Observe the existing process before introducing the agent. Record who performed each step, what information was missing, and how long active human work took. Queue time is useful too, but it should not be confused with labor saved.

The first discovery conversations should ask:

1. Show the last bug report that an engineer sent back for more information.
2. What was missing, and who had to obtain it?
3. How many similar reports arrived last week?
4. What do Jam, existing tests, issue templates, or a general agent already solve?
5. Can a dedicated test account reproduce the relevant state?
6. What result would make this ticket usable without another clarification round?
7. Would the team run the same workflow on its next real report?

For Client Chase, substitute the last delayed deliverable, the exact missing materials, and the team's current collection tool. Avoid asking whether an "AI assistant" sounds useful. Evidence comes from actual work and subsequent behavior.

The following thresholds are proposed decisions for a small pilot, not market benchmarks. Collect ten representative web reports across at least three teams. Seek six investigations that produce engineer-accepted evidence without substantial rewriting, including at least four independently reproduced bugs. Treat false claims of successful reproduction as blocking defects. Track unresolved reports separately and preserve their reasons. Aim for three users to return with another report within seven days without a personal reminder.

Also measure installation completion, time to the first useful result, active human minutes per report, agent execution cost, and duplicate-ticket incidents. Token consumption is an event reporting requirement, not a product success measure. Useful work should drive usage; empty polling, repeated installs, and unnecessarily long agent loops make the product worse.

A live demonstration should use an authorized test application with an actual bug. Submit the complaint through the supported chat, show the agent's observed failure, and create a reviewed issue with its evidence. Then show a second example where a missing test login causes a truthful blocked result. The demonstration should make both the completed job and the limits visible. A fixture used for repeatable testing must be identified as such and kept separate from claims about pilot adoption.

There is a plausible business after the event, but no validated pricing yet. Keep the installable core MIT-licensed as required, with a possible paid managed service for hosting, team configuration, support, and retained evidence. An initial interview could test a $49 to $149 monthly team budget against the customer's observed workload. These amounts are experiment prompts, not market-derived recommendations or competitor prices.

Estimate the service economics from actual pilot runs. Include model calls, browser execution, storage, support time, failed investigations, and retries. Divide the full operating cost by useful completed investigations. A cheap individual model call can still produce an expensive service when environments require frequent manual repair. Meter heavy use only after the cost distribution is understood.

The current evidence justifies a narrow experiment. It does not establish product-market fit, a defensible market position, production security, or a likely hackathon ranking. Vendor case studies suggest pain and existing spending; technical documentation establishes available mechanisms; the research paper informs report design. Only independent installation and repeated use on real work can establish whether this particular product deserves to continue.

The next commitment should be small and concrete: three software-team introductions, ten recent bug reports, and one approved staging environment. If those are available, build Repro Relay's report-to-ticket path. If the strongest introductions are agencies with client materials due this week, build Client Chase around that work instead.

Sources follow. Undated product pages and repository documentation were checked September 11, 2026; they describe the public versions available at that time.

[^1]: Daniel Delattre, [Hermes Hackathon event description](https://luma.com/3uftu95w), current public event page and embedded calendar metadata, accessed September 11, 2026.
[^2]: Hunted.space, [AI Worth Using hackathon launch listing](https://www.hunted.space/dashboard/plow-hackathon), accessed September 11, 2026. Secondary source used only to document conflicting earlier event details.
[^3]: AI Worth Using, [Agent Index](https://aiworthusing.com/agent-index), verification and deployment notices, accessed September 11, 2026.
[^4]: Atlassian, [State of Teams 2025](https://www.atlassian.com/blog/state-of-teams-2025), 2025 report landing page.
[^5]: Sukrit Kumar, Drishti Goel, Thomas Zimmermann, Brian Houck, B. Ashok, and Chetan Bansal, [Time Warp: The Gap Between Developers' Ideal vs Actual Workweeks in an AI-Driven Era](https://arxiv.org/abs/2502.15287), February 21, 2025; ICSE SEIP 2025.
[^6]: Lara Khatib, Noble Saji Mathews, Meiyappan Nagappan, Pengyu Nie, and Thomas Zimmermann, [What Makes a Good Bug Report for an AI Agent?](https://arxiv.org/html/2607.07593v1), July 8, 2026. Research preprint; see especially methods and threats to validity.
[^7]: James Rose, Content Snare, [Content Snare results survey](https://contentsnare.com/results-survey/), updated September 2, 2024. Paying-customer survey and methodology notes.
[^8]: Linear, [Customer Requests](https://linear.app/docs/customer-requests), product documentation, accessed September 11, 2026.
[^9]: Linear, [Intercom integration](https://linear.app/docs/intercom), product documentation, accessed September 11, 2026.
[^10]: Linear and Pylon, [Pylon integration](https://linear.app/integrations/pylon), integration description, accessed September 11, 2026.
[^11]: Fellow, [AI meeting action items](https://fellow.ai/features/action-items), product description, accessed September 11, 2026.
[^12]: Zapier, [Meeting follow-up automation](https://zapier.com/automation/use-case/track-and-manage-followup-actions-from-meetings), workflow description, accessed September 11, 2026.
[^13]: Microsoft WorkLab, [Breaking down the infinite workday](https://www.microsoft.com/en-us/worklab/work-trend-index/breaking-down-infinite-workday), June 2025; methodology specifies the telemetry period and population.
[^14]: Content Snare, [Kickstart Web Design customer story](https://contentsnare.com/success-stories/kickstart-web-design/), accessed September 11, 2026. Historical vendor-published customer interview.
[^15]: Jam, [Product capabilities](https://jam.dev/), including customer recording links, MCP, CLI, and webhooks, accessed September 11, 2026.
[^16]: Bugster, [Browser testing product](https://bugster.dev/), accessed September 11, 2026.
[^17]: GitHub, [Deployments API](https://docs.github.com/en/rest/deployments/deployments) and [deployment statuses API](https://docs.github.com/en/enterprise-cloud%40latest/rest/deployments/statuses), accessed September 11, 2026.
[^18]: Canny, [Customer feedback management product](https://canny.io/), accessed September 11, 2026.
[^19]: Nous Research, [Hermes documentation](https://hermes-agent.nousresearch.com/docs/), [skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/), and [scheduled tasks](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/), accessed September 11, 2026.
[^20]: Plow, [Latch](https://plow.co/latch), access and credential-handling description, accessed September 11, 2026.
[^21]: Microsoft Playwright, [Trace viewer](https://playwright.dev/docs/trace-viewer), official documentation, accessed September 11, 2026.
[^22]: Plow, [agent-mgr repository](https://github.com/plow-pbc/agent-mgr), deprecation notice, accessed September 11, 2026.
[^23]: Plow, [plow-agents repository](https://github.com/plow-pbc/plow-agents), installation and leaderboard documentation, accessed September 11, 2026.
[^24]: Plow, [plow-hermes-agent repository](https://github.com/plow-pbc/plow-hermes-agent), base image and variant-image documentation, accessed September 11, 2026.
[^25]: Plow, [Agent Index client](https://github.com/plow-pbc/agent-index-client), reporting, credentials, and installation identity documentation, accessed September 11, 2026.
