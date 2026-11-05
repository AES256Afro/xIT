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
| Code | 1 | 0 | active |
| Bug | 1 | 0 | active |
| Security | 1 | 0 | active |
| Readability / usability / visual | 1 | 0 | active |
| Quality of life | 1 | 0 | active |
| Platform features | 1 | 0 | active |
| Optimisation | 1 | 0 | active |

No category is eligible to retire: every one produced findings on sweep 1.

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
| C10 | No `_locales`. Every string is inline English, so the extension cannot be localised and both stores show it as single-locale. **Partly fixed in 1.2.0:** there is a catalogue, the manifest's strings come from it, and `lib/i18n.js` gives HTML and JavaScript a way in. The interface's own strings are still inline; carried as C11. | whole tree |
| C11 | The interface's strings are still inline English: roughly 60 in `options.html`, plus the toasts, statuses and menu labels built in `inject.js`, `popup.js` and `background.js`. The mechanism to move them exists as of 1.2.0, so this is now mechanical rather than structural, and it is the last thing C10 was asking for. | `src/options`, `src/popup`, `src/content`, `src/background.js` |

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
| P3 | No i18n (see C10). **Partly fixed in 1.2.0**, same scope as C10. |
| P4 | No reachability check. One user-initiated HEAD per host would let the UI mark an entry as unreachable instead of letting it fail silently at copy time. **Fixed in 1.1.0:** one HEAD request per host, on the button press, with optional host permissions requested at that moment. |

### Optimisation

| id | Finding |
|---|---|
| O1 | `syncTheme` unthrottled on body attribute mutations (same defect as B5, counted once in the fix). |
| O2 | `renderList` in the popup re-runs `XIT.convert` for every redirector on every keystroke in the paste field. Cheap at eight entries, not cheap once a catalogue can add thirty. |
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
