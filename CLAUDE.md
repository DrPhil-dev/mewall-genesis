# My Life Wall — Project Context (mewall-genesis / years repo)

Read this before touching any code. Companion sections below cover: what the
product is, who's involved, the three-repo family, the code architecture, and
the current holding-point status.

## Current status — holding point as of 2026-08-22

Dr Phil has deliberately paused here: **"a working model with which most
people are happy"** has been reached, and this is being called a holding
point subject only to minor palette / bits-and-pieces changes, not active
feature work. Forward roadmap is intentionally undefined for now — work so
far has been reactive (test, screenshot, fix), and the plan is to gather real
feedback before deciding what's next.

**Known issues to revisit next session (not yet investigated):**
- Potential issues with the PDF (Life Book) printer/export path.
- Potential issues with page numbers appearing within edit mode.

**Verified state of the three-repo family as of this date:**
- `mewall-genesis` (this repo) and `mewall-genesis2` each received a large,
  matching "Upgrade" commit within a minute of each other (2026-08-22,
  ~16:48–16:49) — a ~786-line diff across `app.js`/`index.html`/`style.css`,
  consistent with the "full always-editable rebuild" described below. This
  was the finished output of a prior Claude (web/desktop chat) session,
  downloaded and committed via GitHub Desktop.
- `mewall-genesisbob`'s `app.js` was independently diffed against
  `mewall-genesis2`'s and found **byte-identical** — sync is currently
  intact, just arrived via a different trail of same-day commits ("Heading
  changes", "Endless button movements", "Buttons to match screens") rather
  than one `Upgrade` commit.

**"Refer a Friend" — confirmed, designed feature (2026-08-16):** a menu
button (`#referFriendButton`, `App/index.html`) opens the user's email
client via a `mailto:` link with a pre-written invitation subject/body,
signed with the sender's name if set (`App/app.js`, in the
`referFriendButton` click handler). Present identically in `genesis` and
`genesis2`.

**Invite email domain — intentional, not a bug.** The invite body links to
`https://my-life-wall.pages.dev` (the stale `My-Life-Wall` repo's demo
site), not `mewall.pages.dev`. Confirmed deliberate: John prefers this demo
over the "real" one for now. The actual eventual product is
**`https://mylifewall.com`** — Oren's separately-built commercial executable
version — and the invite link should point there once that's the live
release Dr Phil wants referred friends landing on. Update it then, not now.

(The `OLD 2026-08-22` folder and other stray zip directories previously
noted here were reviewed and deleted by Dr Phil — resolved.)

## ⚠️ File layout in THIS repo differs from the other two

Unlike `mewall-genesis2` and `mewall-genesisbob` (app files at repo root),
**this repo's live app lives under `App/`**: `App/app.js`, `App/index.html`,
`App/style.css`. The repo root also contains a separate, much larger
vision/planning document tree (`Architecture/`, `Blueprints/`, `Book/`,
`Engineering/`, `Specifications/`, `Founders_Journal/`,
`Architects_Notebook/`) — these are aspirational/future-scope documents
(a much bigger domain model than the current single-page app implements) and
are **not** the working code. Don't confuse them with the architecture
section below, which describes the actual running app in `App/`.

## What this is

My Life Wall (**mewall.pages.dev**) is a memoir/life-story application. A
person records their life a chapter or year at a time, writing, dictating, or
photographing their way through it, and it all gathers into a printable
**Life Book** at the end. It is being sold as a **desktop computer program**,
not a mobile app — design and testing effort should go into desktop layouts.
Mobile is a basic fallback only, not a priority, unless explicitly asked.

## People

- **Dr Phil** — creator of the app and the person you're working with.
- **John Koorey** — client, commercialising the product.
- **Oren** — developer building a separate commercial executable version.
- **Belinda Foote** — created the original hand-drawn quill-writer artwork
  used throughout the app (`quill-writer-left.png` / `quill-writer-right.png`).

## The three repos, and why each exists

- **`mewall-genesis`** — organises memories by **calendar year**, with the
  person's age shown alongside each year (calculated from their date of
  birth). This is the original structure: a life laid out the way a
  biography naturally runs, year by year.
- **`mewall-genesis2`** — organises memories by **chapter**, a
  user-named, freely-ordered container ("Central Police Station", "The Navy
  Years") rather than a fixed calendar year. This exists because not
  everyone's memories sort cleanly by year — some people think in eras,
  jobs, relationships, or themes instead, and forcing those into calendar
  years lost stories or made the wall confusing to navigate. Chapters solve
  that by letting the person define their own containers.
- **`mewall-genesisbob`** — a **live-testing deployment for a friend, Bob
  Lee**, running the exact same codebase as `mewall-genesis2` (chapters),
  seeded with Bob's own memoir content imported from a Word document into
  the app's JSON backup format. Not a fork or a mistake: it gives a real,
  long, multi-chapter, real-world dataset to test against, and gives Bob an
  actual working copy of the app to build his own book in. Because it's
  meant to stay an exact copy of `genesis2`'s code, it belongs on the
  "keep in sync" list — any future UI/behaviour change landing in `genesis2`
  should be ported to `genesisbob` too. `genesisbob`'s actual memory data
  (Bob's content) must never be touched by a code sync.

All three are real, live products/deployments, not one canonical version and
experiments. **Changes generally need to land in all three**, adapted for the
years-vs-chapters difference below. Test conversions from a friend's
Word-document memoir into the app's JSON format have also been done directly
against these repos as a secondary workflow (see "Other workstreams" below).

### The one genuine structural difference to respect

Everywhere else, the codebases are near-identical (same element IDs, same
file layout *within `App/` vs root — see file-layout note above*, same
functions) — but this one distinction is real and must never be collapsed:

| | mewall-genesis (years) | mewall-genesis2 / genesisbob (chapters) |
|---|---|---|
| Open function | `openYear(year, age)` — **two params** | `openChapter(chapterNum)` — **one param** |
| Heading subtitle (`yearAge` span) | Shows `– Age {age}`, genuine distinct info, always kept | Left empty — repeating the custom title here was found to be redundant with the title field below it, so it was deliberately blanked |
| Custom title storage | `settings.yearTitles`, via helper `getYearTitle(year)` | `settings.chapterTitles`, inline lookup |
| Last-opened tracking | `settings.lastUsedYear` | `settings.lastUsedChapter` |
| Wall bricks | No rename/mark-current tools — years are fixed by birth date | Has `.brick-tools` (pencil to rename, star to mark current) — pre-existing, chapter-specific, never touched during the floating-UI rework |

If a future change touches `openYear`/`openChapter`, or the heading area,
check both sides of this table before assuming the repos should end up
identical.

## Development history

### Early build (before the rebuild session)
A substantial UI and architectural overhaul had already landed in all repos
before the most recent working session, including: permanently editable
memories were first introduced (removing a separate edit/read mode), a
floating left/right column layout replacing fixed top/bottom bars, a
per-memory editor architecture (`createMemoryEditor` factory instead of one
shared editor instance), generalised voice-to-text across Notes/Foreword/
Afterword, grouped photo controls, and a JavaScript-measured solution for
positioning the floating left column correctly across very different screen
sizes (a laptop, a large broadcast display, a 4:3 monitor, a tall portrait
screen, and others) after multiple CSS-only attempts failed.

### The full always-editable rebuild (landed 2026-08-22, see holding-point note above)
Starting from a version that still had a separate boxed "editor" panel and a
pencil-to-edit step, the following was rebuilt from scratch, chapter repo
first, then ported across to the year repo:

1. **Removed the edit/read distinction entirely.** Every memory now has its
   own permanently-live TipTap editor instance (`createMemoryEditor`), not
   one shared editor swapped between memories. Click into any memory,
   anywhere, and start typing — no pencil icon, no "Edit this memory"
   button. This also fixed a real bug: the old pencil button would jump to
   the wrong memory and reopen everything, because of how the single shared
   editor tracked "which memory is being edited." Removing the shared-editor
   model removed the bug's entire cause, not just its symptom.
2. **Autosave replaced the explicit Keep/Cancel step.** Each memory
   debounces changes (600ms after typing stops) and saves automatically,
   with a brief "· Saved" flash. A brand-new memory is held as an
   uncommitted **draft** (not yet in `memories[selectedYear]`) until it
   actually has content, so an abandoned blank entry never gets saved or
   clutters the list.
3. **Floating columns rebuilt.** Left column: Home Wall + start-a-new-
   memory, stacked square buttons, always visible while on a story page.
   Right column: formatting, photo tools, Record Memory (deliberately
   bigger than the rest, since it's the primary way in), and jump-to-top/
   bottom — also always visible now, not tied to an "editing" state, since
   editing is the permanent state of every memory.
4. **Delete moved off its own line.** Previously a full-width row above
   every memory (costly on a small screen, repeated once per memory). Now a
   small, quiet icon in the memory card's own top-right corner, matching
   the treatment already used for the wall's brick tools.
5. **A genuine, hard-won bug fix on photo sizing.** Selecting a photo then
   clicking Small/Medium/Large used to require a double-click, every time.
   Root cause: the code that resets "which photo is selected" was firing on
   *every* editor focus event, including the internal refocus that happens
   when a toolbar button hands focus back to the editor after being
   clicked — wiping out the very selection the button was about to use. Fix:
   only clear the tracked photo position when focus moves to a genuinely
   *different* memory's editor, not on every refocus of the same one.
6. **Left-column position, several rounds of iteration.** Went through
   guessed-pixel attempts (top/left values nudged back and forth across
   several rounds of feedback), a wrong turn into anchoring it to the card's
   own corner via `position: absolute` (rejected — it must stay
   `position: fixed` so it **scrolls along with you** and stays reachable on
   a long story, not scroll away with the page), and settled on the right
   answer: a JavaScript function (`positionLeftFloatColumn`) that measures
   the *actual* on-screen top of the story card and bottom of the title
   field every time a story page opens or the window resizes, and centres
   the button block in that real, measured gap. This is the only approach
   that genuinely holds up across very different screen sizes and aspect
   ratios, since CSS alone has no way to know how much the header above it
   will wrap on a given screen.
7. **Heading simplified.** Dropped the "Memories:" prefix. In the chapter
   repos, the custom title no longer repeats next to the heading (redundant
   with the field directly below it). In the year repo, "– Age X" was
   correctly *kept*, since it's genuinely different information, not a
   repeat.

### Other workstreams
A secondary use case exists alongside the main app: converting a friend's
memoir from a Word document into My Life Wall's JSON backup format, then
generating a Life Book PDF from it. This has been done for real (a full
79-story, 11-chapter conversion for Bob Lee — see `mewall-genesisbob`
above), verified through the app's own Import Backup mechanism, with the PDF
generated server-side when browser print-to-PDF failed. (Note: PDF export is
one of the two known issues flagged for next session — see holding-point
note above.)

## Working principles — how Dr Phil likes this project run

- **Agreed-list approach.** Assemble and confirm a full list of proposed
  changes before implementing, rather than a drip-and-build style. This was
  explicitly requested after frustration with unexpected changes appearing
  without warning.
- **Explain before fixing.** When something breaks or a mistake is made,
  give a plain explanation of what went wrong before applying the fix —
  transparency over quiet correction.
- **Desktop-first.** This is sold as a computer program, not a mobile app.
  Don't spend effort on mobile breakpoints unless explicitly asked; a basic
  fallback is enough.
- **Verify before handing off.** Files should be syntax-checked,
  brace/tag-balanced, and ID-cross-referenced between JS and HTML before
  being considered done — a "looks right" pass isn't enough on its own.
- **Three-repo discipline.** `mewall-genesis`, `mewall-genesis2`, and
  `mewall-genesisbob` need to be kept in sync for shared code/functionality
  changes — `genesisbob` runs the same codebase as `genesis2` and should
  receive the same updates. The years-vs-chapters differences in the table
  above always need to be preserved deliberately between `genesis` and the
  other two, never accidentally collapsed. `genesisbob`'s actual memory
  data (Bob Lee's content) is never touched by a code sync.
- **Cloudflare Pages, not Workers.** Dr Phil uses Pages for deployment and
  has accidentally created unused Workers before through dashboard
  confusion — always confirm which product is actually being used if
  deployment comes up.

## Toolchain

- **Git workflow (decided 2026-08-22): Claude Code commits and pushes
  directly.** Once Dr Phil approves a specific change in chat, commit it
  with a clear message and push straight to GitHub — no separate GitHub
  Desktop review step needed for that change. This is a standing
  authorization for the push action itself; it does not extend to unrelated
  future changes, which still need their own approval in chat first.
  GitHub Desktop remains available for Dr Phil's own manual use any time.
- **Cloudflare Pages** for deployment (`mewall.pages.dev`), used
  infrequently enough that step-by-step interface guidance usually helps.
- **Claude Code (desktop app, Local sessions)** now set up against these
  repo folders directly — no more uploading/downloading files by hand.
- **Tiptap** is the rich-text editor library the whole memory-writing
  experience is built on.

---

# Code Architecture (applies to `App/app.js`, `App/index.html`, `App/style.css` in this repo)

A map of what the code actually looks like right now, so a new session can
orient quickly without reading every line first. Pair this with the project
context above for the *why*; this section is the *what* and *where*.

## File layout

Each of the three repos is a single-page app: three files, no build step, no
framework. **In this repo they live under `App/`** (see the ⚠️ note above) —
in `mewall-genesis2` and `mewall-genesisbob` they sit at the repo root
instead.

- **`index.html`** — all markup for every page/state (Home Wall, story view,
  Notes/Foreword/Afterword, setup, Menu, etc.), shown/hidden via a `.hidden`
  class rather than separate routes.
- **`app.js`** — everything, loaded as `<script type="module">`. Tiptap and
  its extensions are imported from `esm.sh` at the top.
- **`style.css`** — one stylesheet, custom properties in `:root` for the
  colour palette.

## The story page (where almost all recent work has happened)

`#yearView` (chapter repos call the open function `openChapter`, year repo
calls it `openYear` — see the structural-difference table above). Structure
inside it, top to bottom:

- `.year-top-row` → `.year-heading` (`#yearTitle` h2, `#yearAge` span)
- `#yearCustomTitleInput` — the year/chapter's optional custom title
- `.memories-section` → `#memoryList`, where every memory card is rendered

**Outside** `#yearView` but still part of the story page: the two floating
columns, `#floatColLeft` and `#floatColRight`. They're siblings of
`#yearView` in the DOM (not nested inside it), `position: fixed`, so they
follow the viewport as you scroll rather than the card.

## The per-memory editor pattern (the core architecture)

There is **no single shared editor**. Every memory card gets its own live
Tiptap instance, created by the `createMemoryEditor(container)` factory.
Key pieces:

- **`editor`** (top-level `let`) always points at *whichever instance was
  last focused*. The floating right column's buttons (bold, photo insert,
  alignment, etc.) act on this variable, not on a specific instance — that's
  what lets one shared toolbar work across many independent editors.
- **`activeCardEditors`** — a `Map` from memory object → its live editor
  instance, used to destroy instances cleanly on re-render.
- **`draftMemory`** — at most one at a time. A new "Record another memory" /
  "New Memory" click creates a draft object that renders as a live card but
  is *not yet* in `memories[selectedYear]`. It only gets pushed into the
  real array (via `commitMemoryChanges`) once it actually has text or an
  image. Leaving the page with an empty draft just discards it.
- **`scheduleAutosave(memory, cardElement)`** — debounced 600ms per memory
  (tracked in `autosaveTimers`, a `Map`, not one shared timer — important,
  since a single shared timer would let typing briefly in memory A then B
  silently drop A's change).
- **`flushPendingAutosaves()`** — called at the top of `renderMemories()`
  before destroying editor instances, so a pending change on a *different*
  memory than the one that triggered the re-render (e.g. deleting one memory
  while mid-debounce on another) is committed synchronously first rather
  than lost.

## Photo functions take an explicit target now

`insertPhoto`, `setPhotoSize`, `removePhoto`, `ensureEditableEdges` all
accept an optional `targetEditor` parameter, defaulting to the shared
`editor` variable. Internal callers (paste/drop handlers inside
`createMemoryEditor`) pass the specific instance explicitly rather than
relying on the shared variable, since multiple editors can exist
simultaneously.

**Known-fragile spot:** `lastSelectedImagePos` (which photo is currently
selected, by document position) is only reset when focus moves to a
*different* editor instance (`if (editor !== instance)` inside the `focus`
handler in `createMemoryEditor`) — not on every focus event. This was a real
bug once (see development history above): resetting on every focus broke
Small/Medium/Large after a single click, because a toolbar button's internal
`.focus()` call was wiping the just-set selection. If photo-size bugs
reappear, this is the first place to look.

## Floating column positioning

- **Right column** (`#floatColRight`) — formatting/photo/audio tools,
  vertically centred via plain CSS (`top: 50%; transform: translateY(-50%)`),
  since it needs to roughly track wherever you're scrolled to.
- **Left column** (`#floatColLeft`) — Home Wall / New Memory. Its `top` is
  set by **JavaScript**, not CSS: `positionLeftFloatColumn()` measures the
  real `getBoundingClientRect()` of the story card and the title input, and
  centres the button block in that actual gap. Runs on window resize and
  whenever `updateFloatColumns()` runs (chapter/year open, editor focus,
  text-style panel toggling). Do not replace this with a fixed CSS number —
  that was tried multiple times and consistently broke on different screen
  aspect ratios.
- Both columns' *horizontal* position uses a CSS `calc()` anchored to the
  card's actual width (900px) rather than the viewport edge, so they hug the
  card border rather than floating in the middle of empty space on a wide
  screen.

## Voice-to-text

Generalised beyond the story editor. Two entry points:

- **`startRecording()` / `stopRecording()`** — thin wrappers for the story
  editor's own mic button, calling into the shared capture functions below
  with `{ type: "tiptap", recordButton, stopButton, statusEl }`.
- **`wireFloatingMic(textareaId, micContainerId, micButtonId)`** — used for
  Notes, Foreword, and Afterword. Each gets its own floating mic icon,
  visible only while that textarea has focus, calling
  `startVoiceCapture({ type: "textarea", el, micButton })`.

Both routes share `startVoiceCapture` / `stopVoiceCapture` /
`transcribeAudio` / `insertTranscript`. `insertTranscript` branches on
`target.type`: a tiptap target inserts via editor commands, a textarea
target splices the transcript in at the cursor and fires a synthetic
`input` event so the page's existing autosave listener picks it up exactly
as if it had been typed.

## Things that are dead/legacy but harmless

- `.memory-content`, `.memory-card-title` CSS rules still exist but the
  interactive story page no longer emits that markup (it's still used by
  the Life Book PDF export's own HTML, which is a separate code path — see
  `generateLifeBookHtml`-style functions).
- `resetButton` is referenced in `app.js` but may not exist in every
  deployed `index.html` — guarded with an `if (resetButton)` check
  deliberately, don't remove the guard.

## Verification checklist to run before calling any change finished

1. `node --check app.js` — syntax.
2. CSS brace balance (`{` count equals `}` count).
3. Every `getElementById("...")` in `app.js` has a matching `id="..."` in
   `index.html` (aside from the known optional `resetButton`).
4. HTML tag balance (div/section/button/span open vs close counts match).
5. If a function/element was renamed or removed, grep for its old name
   across all three files to confirm nothing stale is left calling it.
