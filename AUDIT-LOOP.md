# xIT audit loop

Rolling audit. Each category runs until it produces **three consecutive sweeps
with no findings**, then it retires from the loop and this file records the
retirement. A category that retires is not re-opened unless the code it covers
changes shape.

Supersedes `AUDIT-2026-09-14.md`, a point-in-time report deleted in 1.1.1 once
its items were closed. The git history holds it if it is ever wanted.

## Status

| Category | Sweeps run | Clean streak | State |
|---|---|---|---|
| Code | 2 | 0 | active |
| Bug | 2 | 0 | active |
| Security | 2 | 0 | active |
| Readability / usability / visual | 2 | 0 | active |
| Quality of life | 2 | 0 | active |
| Platform features | 2 | 0 | active |
| Optimisation | 2 | 0 | active |

No category is eligible to retire: every one produced findings on sweep 2 as
well, so every clean streak is still 0 and three consecutive clean sweeps are
still owed by all seven.

## What sweep 1 produced

Fixed in 1.0.8: B1, B2, B3, B4, B5, C1, C2, C3, C4, C5, C6, C7, C8, S1, S2.
Confirmed as deliberate and left alone: S3, S4, S5.
Nothing from sweep 1 is still open. Everything else is carried into
milestones 2 to 4.

S1 was not fixed the way sweep 1 proposed. The nonce in the original finding
cannot work: it has to cross into the page's own context over `postMessage`,
which every script on the page can read. The channel was constrained instead
of authenticated, which is recorded as option (a) under Milestone 1 item 3 in
`PLAN.md`.

## What Milestone 2 produced

Fixed in 1.1.0: U3, U4, U6, O4, P4, Q5, and B2's replacement for Unroll Now.
Nothing from Milestone 2 is still open.

P4 and Q5 cost a permission. The version that needs none cannot read a status
code, so it would have called the 503 that retired `unrollnow.com` healthy,
which is worse than the list saying nothing. The check therefore declares
optional host permissions for the hosts xIT ships and asks for them in the
click handler of the Check button. Route (b) under Milestone 2 item 6 in
`PLAN.md` records what that costs at store review.

U4 has assertions at unit and Playwright level, but has not been through a
screen reader, which the finding asks for.

## What Milestone 3 produced

Fixed in 1.1.1: C9, U5, O3. C1 to C8 were already fixed in 1.0.8, so the
milestone's dead-code item was closed before it started.
Nothing from Milestone 3 is still open.

O3 was written as "memoise" and was not memoised. A cache across calls would
have to be invalidated on every settings write, for a function whose cost is
now proportional to the list rather than its square; the two lookups are
indexed once per call instead. The new unit test is a regression guard, not a
proof of the speedup: the fix is behaviour-preserving, so the test passes
against the old code too. It was checked against a plausible slip the index
invites, building it from every redirector instead of the filtered list, and
fails there.

U5's assertions are in `tools/test-qol.mjs`, which needs Playwright and has
not been run here. One of them records every native dialog for the whole run
and asserts at the end that none arrived, so a reintroduced `alert()` or
`confirm()` anywhere in the options page or popup fails the suite.

U5 turned up **U10**, a new finding. Filling a button with `--danger` and
putting white text on it measured 4.11:1, under the AA floor, so that one
control got `--danger-fill` at 5.72:1. Checking the rest of the palette then
showed the problem is not confined to it: `--ok`, `--accent` and `--danger`
all fail as text against the card in at least one theme. That is a change to
every surface in two stylesheets and is left for Milestone 4 rather than
widened into this one.

## What Milestone 4 produced

Fixed in 1.2.0: U7, U8, U10, Q2, Q4. Partly fixed, with the remainder recorded:
C10, P3 and Q1.
Nothing from Milestone 4 is silently open.

Q4 is the only one that touches the main world, so its format crosses the
`postMessage` bridge and is constrained there the way the template is (S1).
The worst a hostile page script can do with it is pick a different one of three
renderings of a link the user was going to copy anyway.

U10 grew while being fixed. The finding named three colours used as text; the
work found that the translucent tints behind several of them cut the contrast
further, that the two filled buttons put white text on 3.00:1 and 4.11:1
grounds, and that the in-page menu on X fails only in light mode. The fix is
per-theme text and fill tokens with their own foregrounds, and
`test/contrast.test.mjs` now measures every pair, including over the tints, so
the next person to reach for a brand hex has to answer to a number. Reverting
one token reproduces the original 2.84:1 exactly.

C10 is the one item not carried to completion. The catalogue, the manifest
strings and the runtime mechanism are in, which is what makes both stores stop
reporting a single locale and gives later strings a home, and that is what
Milestone 4 asked for. Converting the interface's own strings is a separate,
larger, mechanical job and is recorded as C11 rather than left implied. The
build throws on a manifest placeholder with no key, because that failure mode
is an extension the browser refuses to install.

Q1 asked for two things and got one. A command per pinned redirector would
need a `commands` block that varies with the user's settings, which the
manifest cannot do, so that half is closed as not possible rather than left
open.


One thing the split turned up that no sweep had: a thread tool publishes its
own path shape, and `parse()` knew two of them by name. Adding
`twitter-thread.com` without touching `parse()` produced
`fxtwitter.com/t/20` from a twitter-thread link. The shapes are now declared
on the entries themselves, with a test that fails if an entry publishes a URL
it cannot read back.

Unit tests went from 50 to 63 over Milestone 1 and to 82 over Milestone 2.
The four new background tests and the four new content-bridge tests were each
checked by reverting the fix they cover and confirming the matching test
fails, as was the path-recovery guard.

## What Milestone 5 produced

Fixed in 1.3.0: C11, and with it the rest of C10 and P3.
Carried: C12, which is a library-contract change rather than a string move.

The English is derived, not retyped. `tools/i18n-sync.mjs` reads the pages and
`lib/redirectors.js` and works out what each message should say; the catalogue
is generated from that, and the same code backs `npm run i18n`, which the
tests run. Nothing says the same sentence in two files, so nothing can drift.
The one thing a person writes is the description, which is the only context a
translator gets.

A sentence with markup inside it stays one message. `data-i18n-parts` keeps
the element's own children and lets the message place them as {1}, {2} and so
on, so a `<code>` sample or a `<kbd>` key can move. The easy alternative, one
message per fragment, would have made several languages impossible to word
correctly.

Counts use one message per plural form, chosen in the code, because the
browser's message format has no plural rules and a translator cannot add them.

**This work found a real bug.** In Chrome the background loads its libraries
with `importScripts`, and `lib/i18n.js` was not in that list. Nothing was
broken in 1.2.0, because the background did not use it yet, but the first
thing to use it would have thrown on install, in Chrome only. The unit
harness injects the libraries directly, so no existing test could have caught
it. `test/background.test.mjs` now compares both load lists, the service
worker's and the Firefox event page's, against the globals the file actually
references, and that assertion fails when the import is removed.

The harnesses were also changed to run `lib/i18n.js` with the real catalogue
behind it, rather than letting every string fall back to the English in the
call. Changing one message now fails six background tests, which is the point:
the assertions read what the shipped catalogue produces.

## A generated file whose order nothing generated

U11 was a small fix that uncovered a larger one. Rewriting the catalogue for
it reordered fourteen messages that had not changed, because the committed
file was not in the order `i18n:write` produces and nothing had ever checked.
`write()` emits the hand-written messages first, so every message added by
hand since 1.2.0 pushed the file further out of step, and the reshuffle waits
to land in whichever commit next runs the tool.

The order was defined inside `write()` and therefore known to nothing else.
It now lives in `plan()`, which `write()` builds from and `check()` compares
against, so the file's order is as derived as its content. This is the fourth
time this sweep the answer has been "one definition, used by both", after B8,
B9 and Q6, and the third place that definition turned out to be a generator
that nobody checked, after the two harness stubs below.

Verified both ways: a reordered catalogue fails the check, and with the check
removed the same reordering passes everything else. The reorder itself was
confirmed content-identical by comparing every key and value against the
committed file before accepting it.

The fix leaves one limit, recorded rather than hidden. WebExtension messages
have no plural rules, so "$count$ redirectors enabled" is right for every
count but one. A test asserts the bundled count is greater than one, which is
what will catch a bundled set of a single redirector.

## Three harness stubs that were lying

C13 needed `XITStore.allRedirectors` in the background harness, which is a
hand-written fake rather than the real library, and the work turned up three
places where a stub quietly disagreed with the API it stands for. Each would
have made a test pass while the code did nothing.

The storage harness's `storage.local.remove` took a key and deleted
`data[key]`. Both browsers accept a key **or a list of them**, and the fix for
C13's reset passes a list, so the test for it passed before the fix was
written. The stub now accepts both.

The background harness's `allRedirectors` read the harness's current
redirector map and ignored the settings handed to it. The real one derives
from the settings object, and the difference is the whole point of the
mid-check case below: a stale snapshot and a fresh read have to be able to
disagree. They could not, and a reversion went undetected.

The background harness's `XIT` was a hand-listed subset of the library's
surface, retired in 1.3.5 for the same reason: it broke on a new export for
reasons to do with the harness and not the change.

The pattern across all three is one definition written twice. It is what B8,
B9, S6 and Q6 were about in the source, and the test harnesses turn out to
have the same disease. A stub is a second implementation of somebody else's
contract, and nothing holds it to that contract. Where the real thing can be
used, as with `XIT`, it now is.

## A window the prune cannot see

Worth recording because it was not in the finding and only turned up when a
reversion failed to fail. The fix prunes stored results on every settings
write, which covers every route by which a redirector can stop existing. But
a check is as slow as the network, up to forty serial requests, and settings
can change while it runs: its own result then lands *after* the prune and
writes the removed redirector back in, with nothing to clear it until the
next settings write.

So `checkHosts` reads settings again before writing rather than reusing the
copy it started with. Found by reverting the filter in the writer, seeing the
suite stay green, and asking what the filter was actually for: the answer was
nothing, as written, because it was filtering against the same stale
settings. One of the two reasons to revert a fix is to learn the test is
vacuous; the other is to learn the fix is.

## A test that reads the source

B11 is the first fix in this sweep with no behavioural test behind it. The
options page has no DOM harness, and the Playwright suite cannot reach the
Check button either: `permissions.request` opens a prompt drawn by the browser
rather than by the page, which is the whole reason the bug existed and also
why nothing automatable can dismiss it. Neither test route reaches the defect.

So `test/options.test.mjs` asserts on the text of `runCheck` instead: that
`checking = true` appears before the function's first `await`, and that the
early return on a refusal sits inside the block whose `finally` clears the
flag. This is a weaker thing than a behavioural test, and it is recorded as
weaker: it holds the order of two statements, not what the page does.

Writing it caught its own vacuity, which is worth keeping in mind for the
next one of these. The first version of the second assertion anchored on the
first `try` in the function, and `runCheck` has an inline one around the
permission request itself, so a reversion that moved the refusal out of the
block passed. It now finds the block by its `catch (error)` rather than by
position. Three separate reversions each fail it.

## Two render paths, one rule

O5 and O2 were recorded as separate findings in separate sweeps, in separate
files, and they are one defect: a render that rebuilds everything when the
thing that changed decides only part of what is shown. Taken together they
also come apart differently, which is the reason for doing them together.

In the settings list the filter decides *which* rows are shown and nothing
about what a row contains, so the filter can be lifted out of the render
altogether. `renderList` now builds every row and `applyFilter` hides the ones
that do not match, which is called from the keystroke on its own and from the
end of a render. A keystroke creates no elements at all.

In the popup the source decides what two parts of each row *say*, so the
conversions cannot go anywhere: the line under each redirector's name is the
converted URL. What could go is everything else. The rows are built once and a
keystroke rewrites the sub line and the two disabled flags. The conversions
remain one per row per keystroke, by design, and this is worth being plain
about rather than claiming the finding is wholly gone.

The part of O2 that actually grew with the catalogue was not the conversions.
`opts()` gathers the hosts of every configured redirector by walking them all,
and it was called once per row, which made a keystroke quadratic in the number
of entries. It is now held against the settings object.

Both caches are keyed on settings object identity rather than on a signature
of the fields they depend on. A signature would be a second copy of the rule
"what this render is made of", which is the shape this audit keeps finding
wrong. Identity needs no such copy: `load` and `normalize` each build a fresh
object, so a settings change always brings a new one, and the same object
cannot describe different settings. Two reversions hold the two halves of
that: one that always rebuilds and one that never rebuilds again.

Coalescing renders to one per animation frame was considered and left out. It
would address "per keystroke" more directly than either fix, but it makes
rendering asynchronous, and the suites that would catch the fallout are the
Playwright ones, which cannot be run in this environment.

## A DOM, because source text is not behaviour

`test/options.test.mjs` opened last sweep with a note that the options page is
a DOM file with no harness here, so its tests read the source. Two of this
sweep's own tests then passed while the code was wrong, both for the same
reason: asserting that a line exists is not asserting what the line does.
O5 and O2 are claims about how much work a keystroke does, which source text
cannot express at all.

So `test/helpers/dom.mjs` is an element tree with the handful of selectors the
two page scripts actually use, and `test/helpers/page.mjs` loads a page script
over it with the real i18n, redirectors and storage libraries behind it. The
measure both findings are about is one counter: how many elements were created.
The harness throws on a selector it does not implement rather than returning
nothing, and it auto-creates elements by id rather than parsing the markup,
which the i18n suite already reads directly. Eight tests, nine reversions,
each failing its own.

Deliberately not stubbed: the store. A stub of it would have to repeat what
counts as a redirector group, and the section above on three lying harness
stubs is what that costs. Two of the three remaining static tests in
`options.test.mjs` stay static, because what they hold is the statement order
around the permission prompt, and the prompt is browser chrome that no harness
can put up.

A dual-mode storage stub was needed, and is worth noting as the same class of
defect caught earlier: the store promisifies the callback form while the
options page awaits the promise form directly, so a stub supporting one would
have let every call in the other style pass silently.

## What sweep 2 produced

Eleven findings, all fixed: **B6 in 1.3.1, B10 in 1.3.2, B7, B8 and B9 in
1.3.3, S6 in 1.3.4, Q6 in 1.3.5, B11 in 1.3.6, C13 in 1.3.7, U11 in 1.3.8,
and O5 in 1.3.9**, which took Milestone 2's O2 with it.

Q6 turned on a shape worth naming, since it is the fourth finding of this
sweep to have it. `canonical` returns a string and drops the parts it has
just computed, so a copy built on it cannot see the format and ignores it
without saying so. Four paths were built on it. The fix is not four calls to
`formatCopy` but one function, `cleanCopy`, that parses once and formats
there, so a fifth clean-link copy cannot quietly disagree with the other
four. The same reasoning retired the hand-listed `XIT` stub in the background
harness, which was a second copy of the library's surface and broke on this
change for no reason to do with the change.

S6 named the name. Two more fields from the same file were unbounded for the
same reason: the note, two lines away in the same object, and the template,
which `validateTemplate` checked in every respect except length. A 5 KB
template validated. Fixing only the field the finding named would have been
the mistake B8 and B9 were: one rule applied inconsistently. The name cap is
also written in the markup as `maxlength`, and nothing reapplied it from
JavaScript, so a test now holds the two to the same number.

B8 reached further than this sweep recorded. The same predicate, "do I
already have this template?", was written twice: once in the merge and once
in the import dialog's count of what a file would add. Fixing only the merge
would have left the dialog offering an Add that then added nothing and
reported "Nothing to add." Two copies of a comparison is the shape of the
defect, not a second finding, so both moved to `allRedirectors`.

B9 had the same root. The id pattern lived as a literal in `normalize` and
the merge checked a different condition, so the merge accepted ids normalize
would throw away. There is one `ID_RE` now and both read it.

B10 was worse than this sweep recorded. The copy path at least toasted its
refusal before the background overrode it; the open path replied `{ok:false}`
without toasting anything, so the substitution was silent. Writing the fix is
what surfaced that, which is an argument for fixing a finding soon after
recording it, while the code is still in view.

Four are in code written in the last six releases, three of those in the
import merge and the copy formats from 1.2.0. That is worth stating plainly:
the sweeps are not only finding old debt, they are finding the current work's
mistakes, which is the argument for running them rather than deferring them
again.

B6 was the one to fix first, and was fixed in 1.3.1. It was wrong on every
authorless link rather than on an edge case, it reached a release, and the
test that was supposed to cover it asserted on a shape `parse()` cannot
produce.

It was fixed at the root rather than at the call site. `parse` still reports
`user: 'i'`, because that is what the path says, but nothing tests
`parts.user` directly any more: `XIT.handleOf` is the single place that knows
the difference between a handle and a sentinel, and `expand`, `convert`,
`formatCopy` and the popup all go through it. The duplication was the actual
defect: the popup knew about `'i'` and `formatCopy` did not. The check is
against `RESERVED` rather than against `'i'` alone, so any other site feature
that lands where the account goes is excluded too.

The replacement test drives `parse()` instead of hand-building a `parts`
object, which is what let the original pass. Both halves of the fix were
checked by reverting them: restoring the truthiness test fails it, and
narrowing the check to `'i'` alone fails it as well.

No category retires. Every one produced at least one finding, so all seven
clean streaks are still 0 and sweep 3 is the earliest any streak can begin.

## Sweep 2, 4 November 2026

Baseline: 106/106 unit tests pass at 1.3.0. Browser, Firefox and QoL suites
not run in this pass; Playwright is not installed here.

Sweep 1 read 1.0.7. Six releases have landed since, so most of this sweep is
new surface rather than a re-read: the picker, the catalogue split, the
reachability check, the copy formats, the import merge, the list filter, the
contrast tokens and the whole i18n layer. **Four of the eleven findings are in
code written during those releases**, which is the honest result of auditing
recent work rather than only old work.

Every finding below was reproduced before being written down. Where a probe
was used, what it printed is quoted.

### Bug

| id | Finding | File |
|---|---|---|
| B6 | **Fixed in 1.3.1.** **The author and markdown copy formats invent an account.** `parse()` uses `'i'` as its sentinel for "this link names no account", which `popup.js` already special-cases (`parts.user === 'i' ? '…'`). `formatCopy` tests `parts.user` for truthiness, so `'i'` passes and the output reads `@i`. Every `/i/web/status/` and `/i/status/` link is affected, and so is every link retargeted from a thread tool, because path recovery rewrites those to `/i/web/status/<id>`. Reproduced: `https://x.com/i/web/status/20` yields `[@i](…)` and `@i https://…`. The function's own comment says this case should fall back to `Tweet`, so the intent was there and the check was wrong. Introduced in 1.2.0 (Q4); the test that was meant to cover it passed `{id:'20'}` with no `user` at all, a shape `parse()` never produces. | `src/lib/redirectors.js` |
| B7 | **Fixed in 1.3.1 and 1.3.3.** **A template using `{user}` is never told it needs one.** `normalize` infers `requires` from `{id}` and `{path}` only, so a user template of `https://mine.example/{user}` gets `requires: []`. `convert()` has a `requires.includes('user')` branch that would decline politely, and it is unreachable. Reproduced: that template converts `https://x.com/search?q=a` to `https://mine.example/` and `/i/web/status/20` to `https://mine.example/i`, both silently copied. | `src/lib/storage.js` |
| B8 | **Fixed in 1.3.3.** **A merge can add a second copy of a bundled redirector.** The merge keys "do I already have this?" on `current.custom` templates only, not on `PRESETS`. Reproduced: merging a file whose custom entry is `https://fxtwitter.com/{path}{query}` leaves the list showing FxTwitter twice, once bundled and once as the other person's entry. | `src/lib/storage.js` |
| B9 | **Fixed in 1.3.3.** **A merge silently drops an entry whose id `normalize` rejects.** A colliding id is given a fresh one via `freshId`, but an id that is merely invalid, such as one containing a space, is passed through and then dropped by `normalize`'s id pattern. Reproduced: merging `{id:'has a space', …}` adds nothing and reports "Nothing to add." The template was valid and the entry was usable; only its id was not. | `src/lib/storage.js` |
| B10 | **Fixed in 1.3.2.** **A content script that declines is treated as a content script that is absent.** `handleCommand` falls back to converting the tab's own URL whenever the reply is not `{ok:true}`, but the content script replies `{ok:false}` both when it is not there and when it looked at the tweet under the pointer and refused, having already toasted the reason. Reproduced in a harness: with the reply `{ok:false}` the background still sent `xit:copy-text`. The user sees a toast saying the redirector did not apply, and then a different link lands on the clipboard with a second toast. This is B1's family in a path B1's fix did not cover: the keyboard commands. | `src/background.js` |
| B11 | **Fixed in 1.3.6.** **Two Check clicks can both get through.** `runCheck` returns early on `if (checking)` but sets `checking = true` only after awaiting `permissions.request`, so a second click during the permission prompt re-enters: two prompts, two runs. The per-row Check buttons are disabled by the render that follows the flag, so they are not disabled while the prompt is up. | `src/options/options.js` |

### Security

| id | Finding | File |
|---|---|---|
| S6 | **Fixed in 1.3.4.** **An imported redirector name is unbounded.** Templates from an imported or merged file go through `validateTemplate`, and ids are bounded by a pattern and by `freshId`'s 28-character slice, but the name is only `String(c.name || c.id)`. The 48-character cap is `maxlength` on the two form fields, which is a UI hint and not reached by import, merge or a hand-edited file. The name is rendered as `textContent` everywhere, so this is not injection; it is a file that can carry a 100 KB name into storage, into the list, into the popup and into context-menu titles. The sender gate itself is sound: `sender.id !== api.runtime.id` is the first statement in the message listener, ahead of every handler. | `src/lib/storage.js` |

### Code

| id | Finding | File |
|---|---|---|
| C13 | **Fixed in 1.3.7.** **Reachability results are never cleaned up.** `hostChecks` is written per redirector id and nothing removes an entry. Reset clears `lastCopyFailure` and not `hostChecks`, so "Reset to defaults" leaves the badges behind, and removing a redirector leaves its result stored indefinitely. The key is deliberately outside settings, which is right, but that is also why neither reset nor removal touches it. | `src/background.js`, `src/lib/storage.js` |

### Readability, usability, visual

| id | Finding |
|---|---|
| U11 | **Fixed in 1.3.8.** **The reset dialog states the install defaults in prose.** "three redirectors enabled, FxTwitter as the default" is accurate today and duplicates `PRESETS` in a sentence, so it becomes wrong the moment the bundled set changes, with nothing to catch it. Now that the string is a catalogue message it cannot simply interpolate, but it can take `$count$` and `$default$` placeholders, which is what the message format is for. |

### Quality of life

| id | Finding |
|---|---|
| Q6 | **Fixed in 1.3.5.** **The clean-link copies ignore the copy format.** Every redirector copy honours `copyFormat`; the four paths that copy the plain x.com link (`inject.js` `copyOriginal`, the popup's Copy x.com link, the context-menu item, and the fallback when a redirector declines) all write a bare URL. Somebody who chose "Markdown link" gets markdown from one button and a bare URL from the one next to it. |

### Platform features

| id | Finding |
|---|---|
| P5 | **No `selection` context-menu item.** The menus offer `link`, `page` and `frame`. A tweet URL sitting in a page as plain text, which is how they arrive in a mailing-list archive, a code block or a pasted quote, cannot be converted from the right-click menu at all; the popup's paste field is the only route. `contexts: ['selection']` with the selected text as the input is the platform's own answer. |

### Optimisation

| id | Finding |
|---|---|
| O5 | **The filter rebuilds the whole list on every keystroke.** `renderList` clears `#redirector-list` and recreates every row, its buttons, its listeners and its reachability badge, so filtering an entry does the work of rendering all of them. Harmless at eight entries and the same defect as O2: both only matter once the catalogue is large, which is the direction the list is going. **Fixed in 1.3.9**, with O2, which is the same defect in the other render path. |

## Sweep 1, 4 November 2026

Baseline: 50/50 unit tests pass at 1.0.7. Browser and Firefox suites not run in
this pass.

### Code

| id | Finding | File |
|---|---|---|
| C1 | `RESERVED` lists `notifications` and `messages` twice. Harmless in a Set, but it reads as an oversight. | `src/lib/redirectors.js` |
| C2 | `isMirrorHost` ends with `bare.startsWith('nitter.')`, which the preceding `/(^\|\.)nitter\b/` already matches. Dead clause. | `src/lib/redirectors.js` |
| C3 | The `add-custom` / `edit-custom` / `duplicate-custom` branch computes `base`, `taken` and `id` on every path, including `edit-custom`, which never uses them. | `src/lib/storage.js` |
| C4 | Submit handler does `const id = editingId; ...; if (id !== editingId) return;`. The guard can never fire. | `src/options/options.js` |
| C5 | `toggle` is declared `async` and `await`ed although it only adds a listener. | `src/popup/popup.js` |
| C6 | `<div id="custom-list">` is never populated. Custom entries render into `#redirector-list`. | `src/options/options.html` |
| C7 | `clipboardPayload` dispatches an `xit:toast` CustomEvent that nothing listens for. The `showToast` argument is inert, so a copy that falls back to `scripting.executeScript` gives the user no confirmation. | `src/background.js` |
| C8 | Nothing in the tree sends `xit:copy-via-background`. The handler is dead and widens the message surface. | `src/background.js` |
| C9 | `AUDIT-2026-09-14.md` is 22 KB of superseded report at the repo root. **Fixed in 1.1.1:** deleted. | repo root |
| C10 | No `_locales`. Every string is inline English, so the extension cannot be localised and both stores show it as single-locale. **Fixed in 1.3.0**, apart from C12. **Partly fixed in 1.2.0:** there is a catalogue, the manifest's strings come from it, and `lib/i18n.js` gives HTML and JavaScript a way in. The interface's own strings are still inline; carried as C11. | whole tree |
| C11 | The interface's strings are still inline English: roughly 60 in `options.html`, plus the toasts, statuses and menu labels built in `inject.js`, `popup.js` and `background.js`. The mechanism to move them exists as of 1.2.0, so this is now mechanical rather than structural, and it is the last thing C10 was asking for. **Fixed in 1.3.0:** 191 messages, with the English derived from the markup and the library rather than retyped. | `src/options`, `src/popup`, `src/content`, `src/background.js` |
| C12 | The failure messages `convert()` and `validateTemplate()` return, eleven of them as of 1.3.4, are the last inline English a user reads. They cannot move the way C11's did: `lib/redirectors.js` must stay free of browser APIs, because `tools/build.mjs` evaluates it in a bare context and the unit tests load it alone. The functions would have to return a message code plus parameters, which is a library-contract change with about twenty assertions on it. | `src/lib/redirectors.js` |

### Bug

| id | Finding | File |
|---|---|---|
| B1 | **Silent wrong clipboard.** When `convert` fails in `handleMenuClick`, the handler writes the *raw* target URL to the clipboard with the toast suppressed and only `console.warn`s. Choosing "Copy as Thread Reader App" on a profile link therefore puts a tracking-laden x.com URL on the clipboard and says nothing. It should write the canonical cleaned link and tell the user why the redirector did not apply. | `src/background.js` |
| B2 | **`unrollnow.com` is down.** 503 at both `/` and `/status/20`. A bundled redirector that cannot work. | `src/lib/redirectors.js` |
| B3 | The page-context menu converts `tab.url`, not `info.frameUrl`, so a right-click inside a frame targets the top document. | `src/background.js` |
| B4 | The popup's permission gate checks 3 origins (`x.com`, `twitter.com`, `mobile.twitter.com`) while the manifest declares 6 and `diagnostics()` checks all 6. The popup can report access as fine while diagnostics reports `incomplete`. | `src/popup/popup.js` vs `src/background.js` |
| B5 | `syncTheme` calls `getComputedStyle(document.body)` on every `style` or `class` mutation of `<body>`, unthrottled. X mutates both often, and each call forces a style recalculation. | `src/content/inject.js` |

### Security

| id | Finding | Severity |
|---|---|---|
| S1 | **The main-world config channel has no authentication.** `main-world.js` accepts `{__xit:'config'}` from `window` with no shared token, so any script executing on x.com can set `cfg.template` to an arbitrary `https://` host. X's own "Copy link" then silently yields an attacker-chosen URL, and the isolated world toasts it as a successful copy. Exploitation requires script execution on x.com, which already grants direct clipboard access, so the practical gain to an attacker is small. It is still a trust boundary with no check on it. **Fixed in 1.0.8, but not as proposed here: the nonce does not work, because it has to travel over the same readable channel.** The main world instead refuses any template whose host is not a bundled preset, which reduces an attacker to switching the user between redirectors xIT already ships. A custom default is declined there and handled by the isolated world's DOM-level fallback, so no user loses the feature. | Low, but a real gap |
| S2 | `xit:open`, `xit:copy-via-background` and `xit:open-options` skip the `sender.id !== api.runtime.id` check that `xit:open-original`, `xit:diagnostics` and `xit:mutate-settings` all make. `xit:open` opens a tab at an unvalidated `msg.url`; `xit:copy-via-background` writes caller-supplied text into a caller-named `msg.tabId`. There is no `externally_connectable`, so no web page can reach these, which is why this is defence in depth rather than a hole. The inconsistency is the defect. | Low |
| S3 | `lib/redirectors.js` runs in the MAIN world at `document_start`, so `globalThis.XIT` is readable by page scripts for the interval before `main-world.js` deletes it. The surface is pure functions with no privileges, so nothing is gained by reading it. Noted so it is a decision rather than an accident. | Informational |
| S4 | A page can post `{__xit:'copied', url}` and make xIT display a forged "Copied: ..." toast. Rendered with `textContent`, so no injection. | Informational |
| S5 | **Do not drop `declarativeNetRequest` yet.** HANDOFF suggests dropping it "once users have had time to update", and a naive sweep for unused permissions would flag it. The live store version is **1.0.3**, which installed dynamic redirect rules, and 1.0.7 has never been uploaded. Dynamic rules survive updates, so `clearLegacyRedirects` has to ship in at least one *published* release before the permission can go. Keeping it is correct. | Correction to an earlier conclusion |

### Readability, usability, visual

| id | Finding |
|---|---|
| U1 | No first-run experience. On install the user gets eight redirectors all enabled and FxTwitter chosen for them, with no moment where they are asked. This is the gap the requested copy fills. |
| U2 | Shipping all eight presets enabled is why the options page has to say "Untick any you do not want cluttering the dropdown". The default should be a small set, not an opt-out list. |
| U3 | The context menu builds `Copy as X` and `Open with X` per redirector under the link root, plus `Open this page with X` per redirector under the page root. At eight presets that is roughly 25 items in one menu. **Fixed in 1.1.0:** the menu lists the default and the pinned entries, with a setting for the full grouped list. |
| U4 | Content-script menu rows are `role="menuitem"` containing `<button>` children. ARIA forbids interactive descendants of `menuitem`, so the pin, open and make-default buttons are not reliably reachable by a screen reader. **Fixed in 1.1.0:** the row is a `role="group"` and each action is its own `role="menuitem"` button. Not yet through a screen reader. |
| U5 | `alert()` on a failed import and `confirm()` on reset. Blocking native dialogs in a styled options page. **Fixed in 1.1.1:** the import error is an in-page `role="alert"`, and reset asks in a modal `<dialog>` that says what is lost. |
| U6 | FxTwitter, FixupX and Twittpr are one service under three names; vxTwitter and FixVX likewise. They are presented as five peers with no indication of that, so a new user cannot tell what choosing between them means. **Fixed in 1.1.0:** the five aliases moved to a catalogue, and each says which bundled service it is really an alias of. |
| U7 | No filter or search in the redirector list, and no ordering control for anything that is not pinned. **Fixed in 1.2.0:** a filter over name, host, template and note, and an alphabetical order for unpinned entries. |
| U8 | The shortcut panel asks the user to paste `chrome://extensions/shortcuts` by hand, correctly, but offers no copy button for the address. **Fixed in 1.2.0.** |
| U9 | Pinning is explained in prose in two separate hints and nowhere prompted. |
| U10 | **Fixed in 1.2.0.** The status colours fail WCAG AA as text. `--ok` `#00ba7c` is 2.39:1 on the light card, `--accent` `#1d9bf0` is 2.84:1, and `--danger` `#f4212e` is 3.89:1 on light and 3.60:1 on dark, all against the 4.5:1 floor. They carry meaning in `.saved`, `.warn-text`, the reachability badges and every ghost-button hover, in both the options page and the popup. Found while fixing U5 in 1.1.1; the filled button added there uses a separate `--danger-fill` at 5.72:1, which is a patch over one control, not the palette. |

### Quality of life

| id | Finding |
|---|---|
| Q1 | One keyboard command (`copy-current-tweet`). No "open with default", and no way to bind a pinned redirector. **Partly fixed in 1.2.0:** `open-current-tweet` added, unbound. Binding a specific redirector is not done and is not planned: a command per redirector would mean a manifest that changes with the user's settings, which is not something an extension can do. |
| Q2 | Import replaces the whole settings object. No way to merge somebody else's custom entries into your own. **Fixed in 1.2.0:** import asks, and merging takes their redirectors without their choices. |
| Q3 | Undo holds only the last removed custom entry, in `storage.session`, so it ends at browser restart. |
| Q4 | Only bare URLs. No markdown link, no "author plus link" format. **Fixed in 1.2.0.** |
| Q5 | A dead host and a live host look identical in the list. `unrollnow` would have been caught by the user, not the UI. **Fixed in 1.1.0:** Settings marks a host that answers with a server error or not at all. Reading the status is why it needs a host permission. |

### Platform features

| id | Finding |
|---|---|
| P1 | There is no **catalogue**: a shipped data list of suggested redirectors the user can add with one tap. This is the mechanism that turns "eight things forced on you" into "pick what you want", and it is what lets a contentious entry exist as a choice rather than a default. |
| P2 | No first-run picker (see U1). |
| P3 | No i18n (see C10). **Partly fixed in 1.2.0** and finished in 1.3.0, same scope as C10. |
| P4 | No reachability check. One user-initiated HEAD per host would let the UI mark an entry as unreachable instead of letting it fail silently at copy time. **Fixed in 1.1.0:** one HEAD request per host, on the button press, with optional host permissions requested at that moment. |

### Optimisation

| id | Finding |
|---|---|
| O1 | `syncTheme` unthrottled on body attribute mutations (same defect as B5, counted once in the fix). |
| O2 | `renderList` in the popup re-runs `XIT.convert` for every redirector on every keystroke in the paste field. Cheap at eight entries, not cheap once a catalogue can add thirty. **Fixed in 1.3.9**, with O5: the rows are built once per settings object and a keystroke writes only what the source decides. The conversions themselves stay, because the line each row shows is the converted URL. |
| O3 | `redirectorGroups` does an O(n) `find` per pinned id on every render, in three separate render paths. **Fixed in 1.1.1:** both lookups are indexed once per call. |
| O4 | Any settings write rebuilds the entire context menu: one `removeAllMenus` plus roughly 25 awaited `create` calls, in sequence. Toggling the toast setting pays that cost for no reason. **Fixed in 1.1.0:** the menu is rebuilt only when something it is built from changes. |

## Redirector link audit, 4 November 2026

Probed live, `GET https://<host>/jack/status/20` with a browser user agent.

| Host | Result | Verdict |
|---|---|---|
| `fxtwitter.com` | 302 to x.com | Keep. Default. |
| `fixupx.com` | 302 to x.com | Keep. The x.com-shaped name is the reason to have it. |
| `twittpr.com` | 302 to x.com | **Demote to catalogue.** Live, but a third name for the same service. |
| `vxtwitter.com` | 403 to curl, reachable (FixVX redirects to it) | Keep. The 403 is bot filtering, not an outage. |
| `fixvx.com` | 302 to vxtwitter.com | **Demote to catalogue.** Second name for vxTwitter. |
| `d.fxtwitter.com` | 200 | Keep. Distinct behaviour, not an alias. |
| `threadreaderapp.com` | 301 to the thread page | Keep. |
| `unrollnow.com` | **503** at `/` and at a status path | **Remove.** Does not work. |
| `xcancel.com` | **451 Unavailable For Legal Reasons** | Stays withdrawn. The 451 confirms the cease and desist. |
| `twitter-thread.com` | 200 at `/t/{id}` | **Add.** Live thread unroller, replaces `unrollnow`. |
| `hitlerx.com` | 302 to x.com, response byte-identical to `fxtwitter.com` | Verified as an FxEmbed alias, same operator. **Not shipped**, by decision. See below. |

Also probed and rejected: `t.fxtwitter.com` redirects to the FxEmbed GitHub repo,
so it is not a usable redirector.

### Decision on `hitlerx.com`

Probed because it was asked for, and it checks out: `hitlerx.com` answers with
a response byte-identical to `fxtwitter.com`, so it is a genuine FxEmbed alias
run by the same operator, not a squat. Nothing about it is technically wrong.

It is **not shipped**, decided 4 November 2026. The reason was never the
service, it was the store listing: Chrome Web Store and AMO both have
shocking-content and hate-speech policies, a reviewer reading "HitlerX" in the
extension UI has none of the context that makes it a protest alias, and HANDOFF
records this developer as inside the untrusted-new-developer window where a
takedown is expensive and a resubmission resets the clock.

A user who wants it is not blocked. The custom template field takes it in one
paste:

```
https://hitlerx.com/{path}{query}
```

That validates against `validateTemplate` as it stands, so no code is needed to
support it. This is the general shape the plan is aiming for: the extension
ships a small, defensible default set, and anything further is the user's to
add.
