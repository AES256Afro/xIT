# xIT plan

Derived from `AUDIT-LOOP.md` sweep 1, 4 November 2026. Current repo version
1.0.7, never uploaded. Live store version 1.0.3.

The organising idea: xIT currently decides for the user. Eight redirectors
arrive enabled, one of them is picked as the default without being asked, and
the options page asks the user to untick what it already turned on. Every
milestone below moves one step from "configured for you" to "offered to you,
with a sensible default you can change".

## Milestone 1, correctness and trust

Blocks the store upload. Nothing here changes what the extension is for.

**Status, 4 November 2026: shipped as 1.0.8. Complete.** 63 unit tests pass,
up from 50. Every item is done, together with the Milestone 3 dead-code items
C1 to C6. Item 3 was settled on option (a), constrain instead of authenticate;
the record of why is kept below. The Chrome and Firefox browser suites have
**not** been run: Playwright is not installed here, so `npm run test:browser`,
`npm run test:firefox` and `npm run test:qol` must run on the host before
upload.

1. **Fix the silent wrong clipboard** (B1). On a failed conversion, write
   `XIT.canonical(target)` rather than the raw URL, and surface the reason
   through `copyInTab` so the user is told why the redirector did not apply.
2. **Make the executeScript copy path speak** (C7). Either have the isolated
   world listen for `xit:toast`, or drop the event and the `showToast`
   argument. Right now the argument is inert, so a copy that misses the
   content script is silent.
3. **Constrain the main-world channel** (S1). **Done in 1.0.8, by option (a)
   below.** The nonce originally written into this plan does not work: a nonce
   has to reach the main world over `postMessage`, which every script on the
   page can read, so a page script can simply listen for it. The only window
   in which nothing is listening is before the first page script runs, which
   means moving `content/inject.js` from `document_idle` to `document_start`
   and relying on content script ordering. That ordering holds in practice but
   is not a guarantee worth making a security claim on, and the run_at change
   cannot be verified here. The three options were:
   - **(a) Constrain instead of authenticate.** Chosen. The main world already
     loads `redirectors.js`, so it refuses any config whose template host is
     not one of `PRESETS`. An attacker is limited to switching the user
     between legitimate bundled redirectors. The cost named here, that the
     native "Copy link" rewrite stops working for a *custom* default, was
     paid off rather than accepted: when the main world declines a template,
     `nativeCopyFallback` in the isolated world takes the copy instead, so a
     custom default still works. The isolated world works out the same answer
     for itself in `pushConfig` rather than trusting the main world's reply,
     and the reply can only arm that fallback, never disarm it, so a page
     script cannot suppress it either.
   - **(b) Move both content scripts to `document_start`** and post the nonce
     once, synchronously, never replaying it. Fails closed if the ordering
     does not hold. Cost: a run_at change on the script that injects the
     button, verifiable only by running the browser suites on the host.
   - **(c) Drop the main world entirely** and rely on `nativeCopyFallback`,
     the DOM-level interception that already exists in `inject.js`. Removes
     the trust boundary rather than defending it, and removes a content script
     and a `world: 'MAIN'` entry from the manifest. Rejected: it loses the
     `clipboard.write()` / `ClipboardItem` path, and leaves the feature
     depending on X's DOM, which the rest of the extension deliberately does
     not.
4. **Make the message handlers consistent** (S2). Apply the
   `sender.id !== api.runtime.id` check to `xit:open`, `xit:open-options` and
   whatever survives of `xit:copy-via-background`; validate that `xit:open`'s
   URL is `https:` and belongs to a configured redirector host; take the
   tab from `sender.tab.id` rather than `msg.tabId`.
5. **Remove `unrollnow`** (B2). Dead service. Add a normalisation path so a
   stored `unrollnow` default falls back the way the withdrawn Nitter hosts
   did, with a test alongside the existing 1.0.3 migration test.
6. **Reconcile the host patterns** (B4). One shared list, used by the manifest,
   the popup gate and diagnostics.
7. **Use `info.frameUrl` for frame context menus** (B3).
8. **Throttle `syncTheme`** (B5, O1) to one check per animation frame.
9. **Keep `declarativeNetRequest`** (S5). Explicitly not a cleanup item until a
   release carrying `clearLegacyRedirects` has actually been published.

Done when: unit tests cover B1, the main-world constraint and the `unrollnow`
retirement; the Chrome and Firefox browser suites run on the host;
`npm run prepare-dist` produces 1.0.8 packages. Everything but the browser
suites is done.

## Milestone 2, the choice model

The substance of this plan. Ships as 1.1.0.

**Status, 4 November 2026: shipped as 1.1.0. Complete.** 82 unit tests pass,
up from 63. Item 6 was settled on route (b), optional host permissions
requested on the button press; the record of why is kept below. The Chrome and
Firefox browser suites have **not** been run: Playwright is not installed here,
so `npm run test:browser`, `npm run test:firefox` and `npm run test:qol` must
run on the host. The ARIA work in item 5 has unit-level and Playwright-level
assertions but has **not** been through a screen reader, which the item asks
for and which cannot be done here. The store listings now carry a permission
justification for the optional hosts, which is new text a reviewer will read.

1. **Split presets into a bundled set and a catalogue.**
   - Bundled and enabled on install: **FxTwitter** (default), **vxTwitter**,
     **Thread Reader App**. Three, one per job: embeds, embeds with better
     galleries, threads.
   - Catalogue, shipped as data, nothing enabled until the user taps it:
     FixupX, Twittpr, FixVX, FxTwitter direct media and twitter-thread.com.
     Each entry carries a plain label saying what it actually is, so the alias
     relationships (U6) stop being invisible.
   - `redirectors.js` grows a `CATALOGUE` export beside `PRESETS`. Adding a
     catalogue entry writes a normal entry into `custom`, so there is one code
     path for "a redirector the user chose" and no new storage shape.
2. **First-run picker.** Opens once on install. The copy is the user's:

   > Add your own or choose from these defaults. Change any time.
   > Select a few to be pinned.

   Three bundled entries pre-ticked, the catalogue below them, a template field
   for an own instance, and a pin control inline. Skippable, and re-openable
   from the options page so it is not a one-shot.
3. **Add `twitter-thread.com`** at `https://twitter-thread.com/t/{id}`,
   `requires: ['id']`, replacing `unrollnow`.
4. **Cap the context menu** (U3). Pinned entries plus the default by default,
   with a "show every redirector" toggle. Rebuild only when the inputs that
   affect the menu actually change (O4).
5. **Fix the menu ARIA** (U4). Rows become `role="group"` with a
   `role="menuitem"` button for the primary action, or the buttons move out of
   the row. Verify with a screen reader, not by inspection.
6. **Reachability check** (P4, Q5). **Done in 1.1.0, by route (b) below.**
   Reading
   an HTTP status from a redirector host needs a host permission for that
   host, and 1.0.7 deliberately dropped every optional host permission. The
   two routes:
   - **(a) No permissions.** `fetch(url, { mode: 'no-cors' })` and treat a
     rejection as "no answer". Catches a host that no longer resolves or
     refuses the connection. It cannot read a status code, so a host answering
     503 looks healthy. `unrollnow.com`, the entry Q5 is about, answered 503,
     so this version would have missed it and told the user it was fine, which
     is worse than the list saying nothing.
   - **(b) `optional_host_permissions` for the redirector hosts**, requested
     when the user presses the button and never before. Chosen. Real status
     codes, so 503 is caught. The list is generated from `XIT.CHECK_ORIGINS`
     the way the X origins are, so the manifest cannot offer an origin the
     code will not ask for. A custom template is not checkable and the UI says
     why, rather than declaring a wildcard to cover it. Accepted cost: the
     optional host permissions 1.0.7 removed are back, which is a store-review
     question and a permission prompt, for a feature that marks a list entry.

   User-initiated only, no automatic network traffic, and `PRIVACY.md`, the
   README and both store listings now say so in those words. A test asserts
   that install, startup and a settings write send nothing.

## Milestone 3, retirement and cleanup

Can land alongside either milestone above.

- Delete the dead code: C2, C3, C4, C5, C6, C8, and the `RESERVED` duplicates
  (C1).
- Delete `AUDIT-2026-09-14.md` (C9), superseded by `AUDIT-LOOP.md`.
- Replace `alert()` and `confirm()` with in-page affordances (U5).
- Memoise the pinned lookup in `redirectorGroups` (O3).

## Milestone 4, polish

- i18n scaffolding and `_locales/en` (C10, P3). Nothing new in the UI, but it
  stops every later string from adding to the debt.
- Second keyboard command, "open the tweet in view with the default" (Q1).
- Import offers merge as well as replace (Q2).
- Copy formats: markdown link, and author plus link (Q4).
- Filter field in the redirector list, and ordering for unpinned entries (U7).
- Copy button for the browser shortcut address (U8).

## Explicitly not doing

- **Not reviving page redirecting.** Every bundled embed fixer bounces a real
  browser back to x.com, so there is no destination. Unchanged from 1.0.7.
- **Not restoring the Nitter group or xcancel.** The 451 on `xcancel.com`
  confirms the legal position. Links from those hosts stay readable so they can
  be converted away.
- **Not shipping HitlerX.** Verified as a working FxEmbed alias, and left out
  by decision on 4 November 2026 rather than for any technical reason. The
  custom template field already covers it in one paste,
  `https://hitlerx.com/{path}{query}`, so a user who wants it has it without
  the extension putting the name in front of a store reviewer or anybody else.
- **Not adding anything outside X link rewriting.** The Chrome listing declares
  a single purpose and that is enforced at review.
- **Not dropping `declarativeNetRequest`** until a release carrying the cleanup
  has been published and users have had time to take it.
