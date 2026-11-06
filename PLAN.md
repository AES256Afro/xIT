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

**Status, 4 November 2026: shipped as 1.1.1. Complete.** 83 unit tests pass,
up from 82. The U5 assertions are in `tools/test-qol.mjs` and need Playwright,
which is not installed here, so `npm run test:qol` must run on the host along
with the browser suites still owed from 1.1.0.

- ~~Delete the dead code: C2, C3, C4, C5, C6, C8, and the `RESERVED`
  duplicates (C1).~~ Already done in 1.0.8, before this milestone started.
- **Done.** Delete `AUDIT-2026-09-14.md` (C9), superseded by `AUDIT-LOOP.md`.
  The git history holds it.
- **Done.** Replace `alert()` and `confirm()` with in-page affordances (U5).
  The import failure is a persistent `role="alert"` paragraph in the Backup
  panel, because the user may need to go and look at the file, rather than the
  1.8 second flash the "Saved" status uses. Reset asks in a modal `<dialog>`
  that spells out what is lost, which `confirm()` could not: custom entries,
  catalogue entries taken, pins and the default. Escape and the backdrop mean
  no.
- **Done, differently.** Memoise the pinned lookup in `redirectorGroups` (O3).
  Indexed once per call rather than memoised across calls: a cache would need
  invalidating on every settings write, and the function is now linear in the
  list instead of quadratic, so there is nothing left worth caching.

## Milestone 4, polish

**Status, 4 November 2026: shipped as 1.2.0.** 98 unit tests pass, up from 83.
Five items are complete, three are partly done with the remainder recorded as
findings rather than left implied. The Playwright suites still need a host run,
and now cover the redirector filter as well.

- **Partly done.** i18n scaffolding and `_locales/en` (C10, P3). The catalogue,
  the manifest strings and `src/lib/i18n.js` are in, which is what stops both
  stores reporting a single locale and gives later strings a home. The
  interface's own strings are still inline English and are carried as **C11**:
  mechanical work now rather than structural. The build throws on a `__MSG_`
  placeholder with no key, since that failure mode is an extension the browser
  will not install.
- **Partly done.** Second keyboard command, "open the tweet in view with the
  default" (Q1). Added as `open-current-tweet`, deliberately unbound. The other
  half of Q1, binding a specific pinned redirector, is closed as not possible:
  it would need a `commands` block that varies with the user's settings.
- **Done.** Import offers merge as well as replace (Q2). Merging takes their
  redirectors and none of their choices, matching on the template so a
  redirector you already have under another name is not duplicated.
- **Done.** Copy formats: markdown link, and author plus link (Q4). Applied at
  every copy path including the main world, where the format is constrained the
  way the template is (S1). The markdown destination handles parentheses and
  angle brackets, which would otherwise end the link early.
- **Done.** Filter field in the redirector list, and ordering for unpinned
  entries (U7). The filter is view state, not a setting; the ordering is a
  setting and applies to every list. Pinned order is never touched.
- **Done.** Copy button for the browser shortcut address (U8).
- **Done, and larger than written.** Bring the status colours up to WCAG AA as
  text (U10). The finding named three colours; the work also found the
  translucent tints behind several of them cutting contrast further, both
  filled buttons putting white text on 3.00:1 and 4.11:1 grounds, and the
  in-page menu on X failing in light mode only. Per-theme text and fill tokens
  with their own foregrounds, and `test/contrast.test.mjs` measures every pair.

## Milestone 5, what Milestone 4 left

**Status, 4 November 2026: C11 shipped as 1.3.0.** 106 unit tests pass, up
from 98. 191 messages, none of them typed twice.

- **Done.** **C11.** Move the interface's own strings into the catalogue.
  - Static markup, about 90 strings across `options.html` and `popup.html`,
    marked with `data-i18n`. A sentence with markup inside it uses
    `data-i18n-parts` and keeps its child elements as numbered placeholders,
    so a translator can reorder them. Splitting those into one message per
    fragment would have been simpler to build and impossible to translate.
  - Generated strings in `options.js`, `popup.js`, `inject.js`,
    `background.js` and `storage.js` go through `XITI18N.t`. Counts use one
    message per plural form, chosen in the code, because the browser's message
    format has no plural rules.
  - The library's own prose, group headings, redirector notes and copy-format
    names, is looked up at the point of display by the entry's id.
    `lib/redirectors.js` stays free of browser APIs because `tools/build.mjs`
    evaluates it in a bare context to read the host lists.
  - `tools/i18n-sync.mjs` derives the English from the markup and from the
    library rather than having it typed into the catalogue as well, and the
    same code backs `npm run i18n`, which the tests run. Nothing is retyped,
    so nothing can quietly drift.
- **Carried as C12.** The failure messages `convert()` and
  `validateTemplate()` return, about ten of them. They are the last inline
  English a user can read. Moving them is not a string move: `lib/redirectors.js`
  has to stay free of browser APIs, so the functions would have to return a
  message code plus parameters and let the display side render it. That is a
  change to a library contract with about twenty test assertions on it, and it
  belongs in its own change rather than at the end of this one.
- The sweep loop. **Sweep 2 ran on 4 November 2026** and produced eleven
  findings, so no category retired and every clean streak is still 0. All
  seven are now at sweep 2, and three consecutive clean sweeps are still owed
  by each. See Milestone 6.

## Milestone 6, what sweep 2 found

Eleven findings. **B6 is done in 1.3.1, B10 in 1.3.2, B7, B8 and B9 in 1.3.3,
S6 in 1.3.4, Q6 in 1.3.5, B11 in 1.3.6, C13 in 1.3.7, and U11 in 1.3.8**, one
remains. Full text in `AUDIT-LOOP.md`. Ordered by what
goes wrong for a user, not by category.

1. ~~**B6, the author formats invent an account.**~~ **Done in 1.3.1.** Fixed
   at the root rather than at the call site: `XIT.handleOf` is now the only
   thing that knows `'i'` is a sentinel and not a handle, and `expand`,
   `convert`, `formatCopy` and the popup all read it. The duplication was the
   defect, since the popup knew and `formatCopy` did not. Checked against
   `RESERVED` rather than `'i'` alone. The replacement test drives `parse()`
   instead of hand-building a `parts` object, which is what let the original
   pass.
2. ~~**B10, a refusal is followed by copying something else.**~~ **Done in
   1.3.2.** The reply now carries `handled`, meaning this tab dealt with the
   command and has already told the user the outcome; the background falls
   back only when `sendMessage` throws, which is the real "nobody is there"
   case. `res.ok` is still accepted, because a tab open across an update keeps
   the previous content script until it reloads and that version replies with
   `ok` alone. The open path turned out to be worse than recorded: it replied
   `{ok:false}` without toasting, so its substitution was silent. It now goes
   through `openWith`, which explains the refusal, and the duplicate
   `convert()` that existed only to decide the reply is gone.
3. ~~**B7, `{user}` is not inferred as a requirement.**~~ **Done in 1.3.1 and
   1.3.3.** 1.3.1's `handleOf` stopped `{user}` expanding to the `'i'`
   sentinel; 1.3.3 added the inference, so `convert()`'s requires-'user'
   branch is reachable and such a link is refused rather than mangled. The
   inference is now one function, `inferRequires`, which reads `{path}` as
   "needs nothing in particular" because it already carries both pieces.
4. ~~**B8 and B9, the import merge.**~~ **Done in 1.3.3.** Both turned out to
   be one defect each written twice. B8's predicate, "do I already have this
   template?", existed in the merge and again in the import dialog's count;
   fixing only the merge would have left the dialog offering an Add that then
   added nothing. B9's id rule was a literal in `normalize` and a different
   condition in the merge, so the merge accepted ids normalize would discard.
   Both now read one shared definition: `allRedirectors` for the first,
   `ID_RE` for the second.
5. ~~**B11, the Check race.**~~ **Done in 1.3.6.** The flag is claimed
   before the request and everything after it, the refusal included, sits in
   the try whose `finally` clears it. Setting it earlier also disables the
   buttons while the prompt is up, which is the state the page was in
   anyway. No behavioural test covers this: there is no DOM harness for the
   options page, and the permission prompt is drawn by the browser, so
   Playwright cannot dismiss it either. `test/options.test.mjs` asserts on
   the order of the statements instead, which is weaker and recorded as
   weaker in `AUDIT-LOOP.md`.
6. ~~**Q6, the clean-link copies ignore the copy format.**~~ **Done in
   1.3.5.** All four go through one new `XIT.cleanCopy`, which parses once
   and formats there, rather than four calls to `formatCopy`: `canonical`
   returns a string and drops the parts it computed, which is exactly why a
   copy built on it ignores the format silently. The question of whether the
   x.com link should carry the author was settled by noticing that a mirror's
   path carries the handle too, so "Author then link" has always repeated it;
   a clean link is not a different case, and making it one would be the same
   disagreement in a new place.
7. ~~**S6, an imported name is unbounded.**~~ **Done in 1.3.4.** Two more
   fields were unbounded for the same reason and went with it: the note, in
   the same object, and the template, which `validateTemplate` checked in
   every respect except length. The name and note are truncated, since the
   redirector still works and losing the end of a label beats losing the
   entry; the template is refused with a reason, since a shortened one is
   broken. The name cap was also written in the markup as `maxlength` with
   nothing keeping the two in step, so a test now does.
8. ~~**C13, reachability results are never cleaned up.**~~ **Done in
   1.3.7.** Not a deletion next to each removal, since there are several ways
   a redirector can stop existing and the list grows: one predicate,
   `liveChecks`, applied where the key is written. The prune runs on every
   settings write, which is where every removal route ends. Reset clears the
   key outright, since leaving nothing behind is the point of a reset.
   Disabling keeps the result, because that is a choice the user can take
   back. Two things came out of it that the finding did not name: a window
   where a slow check writes its own result back in behind the prune, and
   three harness stubs that disagreed with the APIs they stand for. Both are
   recorded in `AUDIT-LOOP.md`.
9. ~~**U11, the reset dialog states the defaults in prose.**~~ **Done in
   1.3.8.** The clause is a `data-i18n-parts` child filled from
   `XITStore.DEFAULTS`, which is what a reset applies, with `$count$` and
   `$default$` as the finding suggested. Two things came out of it: the
   catalogue's own key order was generated by `write()` and checked by
   nothing, so it had drifted and a rewrite reshuffled fourteen untouched
   messages; and the format has no plural rules, so a test holds the bundled
   count above one. Both are in `AUDIT-LOOP.md`.
10. **P5, no `selection` context menu.** A tweet URL that is plain text
    rather than a link cannot be converted from the right-click menu. Fix:
    add `contexts: ['selection']` and convert the selected text.
11. **O5, the filter rebuilds the whole list per keystroke.** Same defect as
    O2, which is still open. Both only matter as the catalogue grows. Fix the
    two together, or neither.

Still carried from earlier milestones: **C12**, the failure messages
`convert()` and `validateTemplate()` return, which needs a library-contract
change rather than a string move, and which grew by one in 1.3.4 because the
new template-length message had nowhere else to go; and **O2**, the popup
re-running `convert` for every redirector on every keystroke.

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
