# Launch video: prompts and script

Written September 16, 2026. A 65 second launch film for Repro Relay, built as
nine shots. Every claim here is one the product actually makes today.

## The spine

One line carries the film:

> Every claim carries a timestamp and a quote.

Everything else is evidence for it. Do not add a second message.

## The contrast with Latch

Repro Relay runs on Plow and uses Latch to read a talk in your own browser, so
the honest framing is complement then differentiate, not head to head:

> Latch gives an agent hands. Relay makes it show its work.

**Swap line**, if you want a sharper edge against approval gated agents:

> An approval prompt asks whether the agent may act. It never tells you whether
> the answer was true.

Use one or the other. Never both.

## Voice

Short sentences. No hyphens or dashes of any kind, matching the agent's own
voice. No superlatives, no "revolutionary", no "seamless". The product's whole
argument is restraint, so the film cannot oversell or it contradicts itself.

## Style block

Prepend this to every generated shot.

```
Cinematic documentary style, shot on 35mm, shallow depth of field, natural
window light with practical lamps, muted palette of warm greys, paper white and
a single amber accent. Calm handheld camera with very slight drift. No text, no
captions, no logos, no user interface elements. Realistic, understated, no
stock footage gloss.
```

## Shot list

Generated shots go to a video model. Captured shots are real recordings of the
product. Do not generate a shot marked captured; a fabricated interface
misrepresents the product and reads as fake.

### 1. Hook, generated, 8s

```
A person sits at a desk late in the evening, phone in hand, reading a long
block of text on the screen. Their expression shifts from interest to doubt.
They set the phone down without replying. Close on the face, then the hand
leaving the phone. Warm lamp light, dark room beyond.
```

VO: "Your agent told you what the talk said. Can you check it?"

### 2. The problem, generated, 6s

```
Extreme close up of dense printed text on paper, slowly going out of focus
until the words are unreadable shapes. A hand passes over it looking for
something that is not there.
```

VO: "Most summaries sound right and cite nothing. There is nothing to check."

### 3. Sending it, captured, 8s

Screen recording. Messages on a phone. Paste a YouTube link to the agent's
number and send it.

VO: "So send the talk to a number."

### 4. The reply, captured, 10s

Screen recording. The reply arrives. Hold long enough to read one technique
with its timestamp and its quote. This is the single most important shot in the
film. Do not cut away early and do not speed it up.

VO: "It answers with the technique, the timestamp, and the speaker's own words."

### 5. How it reads, generated, 6s

```
Over the shoulder of a laptop on a kitchen table playing a conference talk, the
speaker small on stage, a transcript panel scrolling steadily beside the video.
Nobody touches the keyboard. Morning light.
```

VO: "It reads the whole transcript in your own browser. It downloads nothing."

### 6. The product, captured, 8s

Use the three real dashboard captures in `docs/screenshots/agent-index`: work
investigation, monitoring, team conversation. Slow push in on each, roughly
three seconds apiece.

VO: "The work it did is kept, not lost in a chat."

### 7. The contrast, generated, 6s

```
Split composition. On the left a hand reaches toward a laptop trackpad, poised
to click. On the right, a printed receipt sits on a wooden table beside a pen,
one line circled in ink. Even light on both halves, neither favoured.
```

VO: "Latch gives an agent hands. Relay makes it show its work."

### 8. The refusal, generated, 7s

```
A close up of a slide projected on a wall, partly washed out by a window so it
cannot be read. The camera holds on it and does not cut to a clearer angle.
```

VO: "And when it cannot read something, it says so. It does not fill the gap."

This shot is the differentiator. A competitor's demo never shows the product
declining. Keep it.

### 9. Install and end, captured, 6s

Screen recording. A terminal. Type `./relay agent` and let the number print.

VO: "One command. Then text it."

End card, added in post, not generated: the wordmark, the spine line, and the
repository name.

## Total

65 seconds. Five generated shots, four captured.

## Music

One sustained piano or felt keys, no percussion, no build, no drop. It should
sound like someone thinking, not like a product launch. Silence under shot 8.

## On screen text

Add every word in post. Never ask the video model to render text. Only two
cards are needed: the spine line after shot 4, and the end card.

## What the film must not claim

- No autonomous posting. The agent drafts and a person sends.
- No claim that it watches channels unattended. The owner sends the link.
- No invented metrics, users, or funding.
- Video digest depends on Latch driving a Mac browser. If the film implies
  Windows and Linux parity, it is wrong about that one capability.
