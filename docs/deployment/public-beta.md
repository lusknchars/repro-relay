# Public beta deployment

Decision, September 12, 2026: publish the browser version on Railway. Serve the built React app and Rust API from one container and one HTTPS origin. Keep PostgreSQL on Railway's private network. The desktop app remains a development companion.

```text
Visitor browser
    |
    | HTTPS, same-origin cookie
    v
Railway web service
  React static files + Rust API
    |
    | private DATABASE_URL
    v
Railway PostgreSQL
  separate guest workspaces, cases, feedback
```

The user's initial infrastructure budget is $20–$50. Start with one web replica and one database. No LLM or browser-worker costs are incurred by this milestone because those integrations are disconnected.

Railway Hobby has a $5/month minimum credited toward resource usage, not a promise that this application costs only $5. Actual cost depends on CPU, memory, storage, and traffic. Estimate $10–$25 for a small early test and review measured usage before inviting more users. This is a planning allowance, not a quote. Visitor counts alone cannot predict compute cost. [Pricing](https://docs.railway.com/pricing)

Railway usage limits apply to a workspace. A hard limit can stop every workload in that workspace. Inspect existing projects before changing it. For an otherwise dedicated beta workspace, propose a $15 alert and $20 hard limit, with review before increasing toward the authorized $50 budget. Leave unrelated workspace limits unchanged. [Cost controls](https://docs.railway.com/pricing/cost-control)

## What a visitor tests

The first visit shows the beta introduction and a **Try a test workspace** button. Clicking it creates a server-side workspace, an opaque HttpOnly session cookie, and one clearly synthetic report. Reloading preserves access. Each browser gets a different workspace; no email signup is required.

A visitor can add observations, publish reviewed memory, prepare handoffs, change a build, reject old context, export a packet, and leave usefulness feedback. No outbound integrations or autonomous agent runs occur. The UI states this before entry and within the workspace.

Guest sessions and workspace data expire after seven days. A cleanup task removes expired live records within about a minute while the service runs, or on startup. Database backups have their own retention and must be configured separately. Project maintainers can inspect test records and feedback. Ask for sample data, not private repository credentials or production customer records.

Limits: 200 active guest workspaces by default, 20 new sessions per minute across the beta, 120 API requests per minute per workspace, 20 reports per workspace, and bounded case history/snapshot sizes. These are capacity controls, not a full bot-defense system. Increase the guest capacity only after reviewing actual storage and traffic.

## Deployment configuration

- Repository root contains `Dockerfile` and `railway.toml`.
- Web service variables: `REPRO_MODE=guest`, `DATABASE_URL` referencing PostgreSQL's private URL, and `PUBLIC_ORIGIN=https://<public-domain>`.
- If no explicit origin is set, the app accepts Railway's `RAILWAY_PUBLIC_DOMAIN` and derives its HTTPS origin.
- The app uses Railway's `PORT`, binds to `0.0.0.0` only in guest mode, and runs as an unprivileged container user.
- Health check: `/api/v1/health`.
- Build the Rust API only; the Tauri desktop package is not deployed.
- Keep one replica for the initial test. Store no durable data on the web container's filesystem.
- Turn off automatic deployment from unreviewed branches. Promote a tested revision from `main`.

The Dockerfile follows Railway's [Docker build support](https://docs.railway.com/builds/dockerfiles). Railway provides a public service domain through [public networking](https://docs.railway.com/networking/public-networking).

## Release checks

1. `make check`: local workflow, guest isolation, expiry, CSRF, quotas, feedback, and browser checks.
2. Build and start the actual container against an isolated PostgreSQL database.
3. Verify the real HTTPS URL from two separate browser sessions. A visitor must not read or change the other's case even with its ID.
4. Record one piece of feedback and verify it reached the intended database.
5. Inspect health, logs, and projected usage before publishing the link.

## Feedback review

The `beta_feedback` table holds the latest usefulness rating and comment for each workspace. It has no public read endpoint. Review it through an authenticated database connection or the provider's database viewer. Feedback expires with its workspace, so export it for analysis within the stated retention window if required and disclose any longer retention first.

## Suggested invitation

> I'm building Repro Relay, a workspace that turns bug reports into evidence-backed handoffs for coding agents.
>
> The first public beta is ready to test: open a sample report, prepare a handoff, then change the build and see outdated context get rejected.
>
> No signup needed. This version tests the workflow; autonomous investigation and fixes are coming next. I'd especially like feedback from engineers who spend time translating vague reports into actionable work.
>
> Try it: [insert verified public URL]

Do not publish this invitation until the live URL has passed the release checks.
