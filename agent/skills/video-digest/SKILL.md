---
name: video-digest
description: Watch a technical talk on YouTube in the owner's own browser and report what it teaches, with timestamps, quotes and a short post draft. Use when someone asks to find videos on a topic, summarise a talk, or turn a talk into notes.
---

# Video digest

Read a talk in the owner's own browser and report what it actually teaches. You
watch by reading the video's transcript panel. You never download media and you
never use your own fetch for the live web.

## Browse

1. Call `plow_list_skills`, then `plow_read_skill` for the browsing skill on that
   Mac. Follow what it says. It describes how the owner's browser is driven.
2. Call `plow_browser_open` to start a session, then use `plow_browser` to
   navigate and read.
3. Call `plow_browser_close` when the work is done, including when you stop early.

## Find the talk

If the person named a channel or a link, go straight there. Otherwise search
YouTube for the topic and prefer conference talks over short clips.

Report what you found before reading it: title, channel, length and upload date.
Then continue with the most relevant recent talk on your own. Only stop to ask
when the person said they want to choose, or when two candidates look equally
good and the topic is expensive to get wrong.

## Read the content

Open the video, open its transcript panel, and read the whole transcript, not
only the part visible on screen. Scroll it to the end, or read it in one call
with an `eval` expression that collects every segment. Check that the last
timestamp you have is close to the video's length; if it is not, you are missing
the end of the talk. The transcript is the content. A title and description are
not.

If the transcript panel cannot be opened, say so plainly, say what you did see,
and stop. Do not fill the gap from the description, the comments or memory.

## Look at the screen

The transcript carries what was said. It does not carry what was shown. Slides,
diagrams, architecture drawings and code on screen are often the substance of a
technical talk, and speakers rarely read them aloud.

For each technique you are about to report, if the speaker points at something
shown rather than spoken, look at it:

1. Clear the advert first. A pre roll runs its own video element, so seeking
   before it ends moves the advert, not the talk. Wait for it, or click the skip
   control, then confirm the page title and player match the talk.
2. Seek the main player, not the first video element on the page. Use
   `plow_browser` with action `eval` and an expression that picks the largest
   playing video and sets its time, for example:
   `const v=[...document.querySelectorAll('video')].sort((a,b)=>b.clientWidth-a.clientWidth)[0]; v.currentTime=322; v.currentTime`
3. Check the returned time. If it does not come back close to the number you
   asked for, the advert is still running or you seeked the wrong element. Fix
   that before taking a frame; never report a frame you did not verify.
4. Wait a second with action `wait`, then take a `screenshot`.
5. Read what is on the slide and use it. Quote a diagram or a code line as what
   was shown, never as something the speaker said. If the frame shows an advert,
   an upsell overlay or the speaker rather than content, discard it and say the
   slide could not be read.

Take a screenshot only where it adds something the words do not. Five or six
frames across a talk is plenty. Each one costs the owner money, so do not
screenshot the speaker's face or a title card.

## Extract

Pull three to five techniques the talk actually teaches. Each one needs:

- a timestamp
- a short quote from the transcript, in the speaker's words
- one line on what it would change in the reader's own work

Drop anything you cannot quote. Three solid techniques beat six vague ones. If
the talk carries fewer than three, say that instead of padding.

When the speaker points at something on screen without describing it, seek to
that moment and look at it, as described above. Report what the slide actually
shows and mark it as shown rather than said. Never guess a slide's contents, and
say so plainly if a frame is unreadable.

## Reply

Answer in this shape:

1. What the talk covers, in two sentences.
2. The techniques, each with its timestamp, quote and what it changes.
3. A short post draft, written plainly, that says what the talk showed and what
   the reader would do with it. Name the talk and the speaker in the draft.

## Rules

- Never say you watched something you only read a title for.
- Never post anywhere. The draft is text in your reply and nothing more.
- Never download video, audio or captions.
- Write plainly. Do not use hyphens or dashes of any kind. Short sentences.
  No filler, no salesy words, no emoji.
- Keep the whole reply under 400 words unless more is asked for.
