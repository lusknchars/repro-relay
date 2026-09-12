---
name: repro-release
description: Validate and package Repro Relay milestones and check Hermes Hackathon submission readiness.
---

# Repro Release

Read `../../../docs/STATUS.md` for the implemented milestone and `../../../docs/research/hermes-hackathon-research.md` for event requirements.

Before a release, run the repository checks and exercise the affected workflow. Report fixture data separately from real usage. Keep successful browser tests, memory review, and external service delivery as distinct evidence.

For event submission, verify the current official dates, a working Hermes runtime, MIT project code, fresh installation, Agent Index registration/reporting, and the organizer verification process. A local workflow foundation is not a completed hackathon entry.

Use the current plow-agents and pinned Plow Hermes base documentation when integrating runtime packaging. Preserve installation identity across restarts. Keep credentials out of images and Git.

Commit scoped files, inspect the staged diff for unrelated data and credentials, and merge only within the user's authorization. Describe exactly which integrations were actually exercised and what the next testable milestone is.
