# Video to skills, documents and references

Design approved September 15, 2026. It describes what to build; nothing here is shipped yet.

## Why

A recorded talk contains techniques the team wants Hermes to use. Today watching one produces nothing durable: notes go stale, and the agent learns nothing. This turns one video the owner supplies into three things kept in the workspace — a profile with evidence, a document a person reads, and a `SKILL.md` the local Hermes actually loads.

## Scope

In: a video file the owner supplies, its transcript and sampled frames, extracted techniques with citations, related references through Exa, a generated document, a generated skill, and a library that stores skills.

Out: posting to social media in any form; fetching video or captions from YouTube, Instagram or TikTok; unattended ingestion from channels. Short-form video uses the identical pipeline but returns far less per processed video, so the first phase is conference talks.

## What the owner does

1. Supplies a media file — a screen recording of what they watched, or a video they own — with a title and the source link as context. Nothing is fetched from a platform.
2. Waits while the worker transcribes it and samples frames.
3. Reads the draft document and draft skill, each claim carrying a timestamp, quote or frame.
4. Runs the draft skill once in the test console.
5. Accepts it, which writes it into Hermes's skills directory, or discards it.

## Units

Each unit has one purpose, its own interface, and its own tests. The library is useful alone; the others build on it.

### Skills library

Stores a `SKILL.md` with its origin, lists what exists, shows one, deletes one. It reads the skills directory directly because `GET /v1/skills` fails in the pinned Hermes build with `_find_all_skills() got an unexpected keyword argument 'include_editorial'` (`gateway/platforms/api_server.py:2642`). That failure is upstream; report it, do not depend on the endpoint.

Accepted skills are written to `<HERMES_HOME>/skills/<category>/<name>/SKILL.md`. The home is resolved from the running runtime's configuration, not hardcoded: `.data/hermes-assessment` on a source installation, `/app/.data/hermes-assessment` inside the connected container. Hermes discovers skills per session with a 30-second cache keyed on directory modification times, so an accepted skill becomes usable within about 30 seconds without restarting the gateway.

Front matter follows the installed skills: `name`, `description`, `version`, `author`, `license`, optional `platforms`, optional `metadata.hermes.tags`, optional `prerequisites.commands`.

### Media worker

A separate container, following `integrations/discord-notes`: a pinned `faster-whisper` release, its model baked in at a fixed revision, `HF_HUB_OFFLINE=1`, running as a non-root user, invoked as a child process. It also carries `ffmpeg`, which the application image does not have.

It returns a transcript with timestamps and contact sheets — nine frames tiled into one image so a talk costs about ten model images instead of ninety.

### Video profile

The durable record: source title and link, media digest, duration, transcript, contact sheet paths, extracted techniques, references, recorded usage and cost, status and error. Every technique carries the timestamp and quote, or the frame, it came from. The document and the skill are generated from this and never from the raw file again.

### References

Processing a video runs a bounded set of Exa searches: the talk's topic, the speaker, and each named tool. These extend the existing `exa_searches` table with a nullable `video_id`, mirroring its existing nullable `competitor_id`, and reuse its deduplication and its `estimated_cost_usd` taken from Exa's `costDollars`. References require the owner's Exa key; without it the profile is complete but its reference list is empty.

### Draft generator

Produces the document and the `SKILL.md` from a profile. It refuses to emit a technique it cannot cite. A profile yielding fewer than two cited techniques is marked thin and produces no skill draft.

## Data

- `skills`: workspace, name, category, description, version, body, status (`draft`, `accepted`), origin (`uploaded`, `generated`), optional video, installed path, accepted run identifier, timestamps.
- `video_profiles`: workspace, id, title, source link, media digest, duration, status (`processing`, `ready`, `failed`, `thin`), transcript, frame paths, techniques, usage, error, timestamps.
- `exa_searches`: add a nullable `video_id` with a foreign key to the profile.

Frames and media stay on the settings volume under a per-profile directory; the database holds paths and metadata, never the bytes.

## Limits and refusals

| Limit | Value | On breach |
| --- | --- | --- |
| Media size | 500 MB | Refuse before processing |
| Duration | 90 minutes | Refuse before processing |
| Transcript | 200,000 characters | Refuse rather than store a partial transcript |
| Contact sheets | 12 per profile | Sample more widely instead of adding sheets |
| Techniques | 12 per profile | Keep the best cited, drop the rest |
| Skill body | 128 KB | Refuse, matching the existing upload dialog |
| Skill name | `[a-z0-9-]`, 3 to 64 characters | Refuse; never resolve a path outside the skills directory |
| Category | One of the existing category folders | Refuse an unknown category |
| Active jobs | One profile processing at a time | Conflict, with the running profile named |

## Acceptance

A generated skill is accepted only after it has been exercised. The owner runs it once through the existing Hermes console, and the run identifier and output are recorded on the skill. Written, exercised, then accepted; anything else stays a draft. This matters because `hermes skills install` accepts only registry identifiers and HTTPS URLs, so a locally written skill receives no install-time safety scan, and an accepted skill becomes part of the agent's standing instructions.

## Access and privacy

Owner only on the local installation, using the guard already shared by runtime usage and the Hermes console: not a guest workspace, not a hosted origin, and any authenticated identity must hold the owner role. Media, transcripts and frames stay on the machine. Nothing is uploaded to a platform, and no credential is written into a profile, a document or a skill.

## Cost

Image tokens are approximately width times height divided by 750, so a 1092 by 1092 contact sheet is about 1,590 tokens. A 30-minute talk sampled every 20 seconds is roughly ten sheets, about 16,000 image tokens, plus the transcript. Exa searches cost a few cents each. Both are recorded per profile from actual usage rather than estimated.

## Testing

- Library: owner-only access, name and size limits, a name that would escape the skills directory, deletion removing the directory, listing a hand-written skill.
- Worker: a short fixture clip, caps enforced, refusal rather than partial output, deterministic frame sampling.
- Profile: one active job, a duplicate submission replayed rather than reprocessed, reconciliation after a restart, a thin profile marked rather than drafted.
- References: searches recorded with cost, deduplication, and an absent Exa key leaving an empty list rather than failing the profile.
- Generator: citations present for every technique, valid front matter, refusal when evidence is thin, no credential echoed into output.
- Browser: the library lists, shows and deletes; a draft cannot be accepted before it has been exercised.

No test performs a network fetch, a platform download or a live model call. The single live check is one real talk processed end to end before the feature is called done.

## Build order

1. Skills library. Nothing else can land anywhere without it, and it alone makes the existing `add-skills.tsx` dialog useful, which today previews a `SKILL.md` and discards it.
2. Media worker.
3. Video profile and references.
4. Draft generator and the acceptance gate.

## Dependencies

- The owner's Exa key, saved in Settings; references stay empty until then.
- `ffmpeg` and the speech model live in the new worker image, not the application image.
- The upstream `/v1/skills` defect stays open; the library does not use that endpoint.
- The acceptance gate runs drafts through the Hermes console, merged as `bef9bd4`. That console is not live in a running installation until its API restarts and migration `0034` applies, so the gate depends on that restart.
