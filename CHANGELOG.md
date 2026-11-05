# Changelog

## 1.3.4

- Put a limit on what a settings file can carry. A redirector's name and note were taken exactly as given, and its template could be any length: the 48-character limit you see in the form is enforced by the form, which an imported file, a merge and a hand-edited file all go around. A name or note that is too long is shortened; a template that is too long is refused with a reason, since a shortened template would simply be broken. Nothing was ever able to run as code this way, but a file could put a hundred kilobytes into a label in the list, the popup and the right-click menu.

## 1.3.3

- A custom template that uses `{user}` but not `{path}` is now told it needs a link with an account in it, instead of quietly copying your redirector's bare address. A link to a search page or to a tweet that names no author produced `https://your.host/` and said nothing.
- Adding somebody else's redirectors no longer gives you a second copy of one xIT already ships. Their file often carries the same services as entries of its own, and only your own list was being checked. The import dialog counts the same way, so it no longer offers to add something it would then skip.
- An imported redirector whose name made an unusable id is now kept with an id derived from its name, as any new entry would be. Previously an id with a space in it was accepted and then dropped, and the import reported nothing added.

## 1.3.2

- Stop the keyboard shortcut copying something you were just told it could not copy. If the redirector does not apply to the tweet under the pointer, for example a thread reader on a profile link, xIT said so and then copied the page's own link anyway, with a second message contradicting the first. A refusal is now the end of it.
- The open shortcut had the same fault and was worse: it said nothing at all and opened a different tweet. It now explains why, like the copy shortcut does.

## 1.3.1

- Fix the author and markdown copy formats inventing an account. A tweet link that names nobody, which is how x.com writes some of them and how every link converted from a thread reader ends up, copied as `@i`. There is no account called i: it is the path segment x.com uses when there is no author to name. Those links now copy as a plain link, and in markdown as `[Tweet](...)`.
- A custom template using `{user}` on such a link produced the host with nothing after it. It now leaves the account out rather than putting `i` there.
- The popup describes one of those tweets as "Tweet" rather than "Tweet by @...".

## 1.3.0

- Finish what 1.2.0 started: the interface can now be translated. Every string a user reads, in Settings, the popup, the in-page menu on X and the right-click menu, comes from a message catalogue instead of being written into the code. Nothing looks different in English; a translation is now a single new file rather than a rewrite of the extension.
- A sentence with a code sample or a keyboard key inside it stays one message, with the markup as a numbered placeholder a translator can move. Breaking those into one message per fragment would have been easier and would have made several languages impossible to word correctly.
- Fix a bug this work uncovered: in Chrome the background never loaded one of its own libraries. Nothing was broken in 1.2.0, where that library was unused there, but the next thing to use it would have failed on install in Chrome only. Both load lists are now checked against what the code actually references.

## 1.2.0

- Choose how a copied link is written: the bare URL, a markdown link, or the author's handle followed by the link. Applies everywhere a copy happens, including X's own "Copy link". Opening a link in a tab is unaffected.
- Add a second keyboard command that opens the tweet in view with your default rather than copying it. It ships unbound, because both browsers already use the obvious combinations and a suggested key that clashes is dropped at install without saying so. Bind it on the browser's own shortcuts page.
- Importing settings now asks whether to replace or to add. Adding brings across only redirectors you do not already have and leaves your default, your pins and your switches exactly as they were. A redirector you already have under a different name is matched on its template rather than its name, so it is not duplicated.
- Filter the redirector list by name, host or note, and order the unpinned entries alphabetically instead of as grouped. Pinned entries keep the order you put them in, which is the point of pinning. The filter is not remembered between visits, because it is a way of finding a row rather than a setting.
- Add a copy button for the browser's shortcuts address. An extension cannot open that page for you, so the address had to be retyped by hand.
- Fix the colours that carry meaning. The blue, green and red were X's brand values, chosen for fidelity and never measured: as text they ranged from 2.39:1 to 3.89:1 against a 4.5:1 accessibility floor, and the filled buttons put white text on 3.00:1 blue. Every one of them now clears the floor with headroom in both light and dark, and a test measures them so this cannot drift back.
- Add the groundwork for other languages. The name, description and shortcut descriptions now come from a message catalogue rather than being hardcoded, so neither store reports the extension as single-locale, and new strings have somewhere to go. The interface itself is still English.

## 1.1.1

- Replace the two blocking browser dialogs in Settings. A settings file that cannot be read now reports in the Backup panel and stays there while you go and look at the file, instead of an `alert()` box you have to dismiss before you can see the page behind it. Reset asks in a dialog that says what is actually lost: your own redirectors, any catalogue entries you took, your pins and your default. The old prompt said only "Reset every setting back to defaults?".
- Build the redirector grouping's lookups once per render instead of searching the whole list for every pinned entry. No visible change; it stops the cost growing with the square of the list now that a catalogue can add to it.
- Delete `AUDIT-2026-09-14.md`, a superseded audit report at the repo root. The git history holds it.

## 1.1.0

- Ship three redirectors enabled, not eight. FxTwitter, vxTwitter and Thread Reader App, one per job. FixupX, Twittpr, FixVX, FxTwitter direct media and twitter-thread.com are still here as a catalogue you choose from, and each one now says what it actually is: three of the old eight were FxTwitter under other names, and two were vxTwitter, which the list gave no way of knowing.
- Add a first-run picker. Pick what you want, pin a few, or paste your own instance, with the catalogue in front of you. It opens once, and the Redirectors panel can open it again whenever you want. Upgrading does not open it: redirectors you already chose are kept, including ones that moved to the catalogue, and a default of FixupX stays FixupX.
- Add twitter-thread.com, replacing Unroll Now.
- Cut the right-click menu down to your default and your pinned entries. It used to list everything enabled, roughly 25 items in one menu. There is a setting to get the full grouped list back.
- Stop rebuilding the right-click menu on settings changes that cannot affect it. Toggling the toast used to rebuild all of it.
- Check whether a redirector still answers, from Settings, per entry or all at once. A host that has gone away is marked in the list instead of failing when you copy. Nothing is checked until you press the button: xIT asks for access to those hosts at that moment, for those hosts only, and makes no network request of its own at any other time. A host that answers is not proof it can still display tweets, and a custom template of yours cannot be checked, because the access would have to be declared in advance and xIT will not ask for every site.
- Make the tweet menu usable with a screen reader. Each row's copy, pin, open and default actions are now separate menu items, which ARIA requires and which the previous markup made unreachable. Left and Right move between them, Up and Down between rows.

## 1.0.8

- Stop putting the wrong link on the clipboard. When a redirector does not apply to a link, for example a thread tool on a profile, the clean x.com link is copied instead of the raw target, and the toast says which redirector declined and why. Previously the raw link was copied silently, tracking parameters and all.
- Remove Unroll Now. The host stopped answering. Links from unrollnow.com are still recognised so they can be converted to a redirector that works, but nothing sends you there.
- Apply the same sender check to every background message. Opening a tab now requires the destination to be a redirector your settings account for.
- Right-clicking inside a frame on X converts that frame rather than the top of the page.
- Read the X origin list from one place, so the manifest, the popup's access check and the right-click menus cannot disagree about which hosts are covered.
- Collapse repeated theme reads into one per frame, instead of one for every style change X makes to the page.
- Stop the page deciding where your "Copy link" goes. The clipboard wrapper that runs in the page's own context now accepts only the redirectors xIT ships, because the channel into that context is readable by every script on the page. If your default is a custom redirector, the copy is handled by the extension's own code instead, so it keeps working.
- Remove dead code: a clipboard toast event that nothing listened for, an unreachable settings guard, an unused element in Settings, and duplicate entries in the reserved path list.

## 1.0.7

- Remove the Nitter-based privacy front-ends (xcancel, twiiit, nitter.net, nitter.poast.org, nitter.privacydev.net) after those services received a cease and desist. Links from them are still recognised so they can be converted to a redirector xIT does offer, but nothing sends you to them.
- Remove page redirecting. Every remaining bundled destination answers a real browser by sending it back to x.com, so the feature had no working target left. The 15-minute pause and the host reachability check go with it.
- Delete redirect rules installed by earlier versions on startup, so nobody is left being redirected to a withdrawn service, and remove the page-redirect settings from stored data.
- Drop the `alarms` permission and all optional host permissions. `declarativeNetRequest` is kept for this release only, to perform that cleanup, and installs no rules.
- Rename "Open on X once" to "Open on X" and stop appending a bypass parameter, which had nothing left to bypass.

## 1.0.6

- Add Open on X once to the popup, tweet dropdown, and right-click menus.
- Pin redirectors in any copy list and reorder pins in Settings, separately from the default star.
- Edit and duplicate custom redirectors. Undo the most recent removal, restoring its enabled state, pin, and unchanged default selections.
- Focus the popup's paste field on unrelated tabs and copy the previewed link with Enter.
- Pause page redirects for 15 minutes, show the resume time and toolbar badge, and resume early or automatically. Add the alarms permission for timed resume.
- Check individual enabled hosts and show when each result was obtained. Preserve the existing request limit and privacy controls.
- Copy diagnostics with browser/extension versions and operational status, excluding URLs, custom templates, clipboard contents, and raw errors.
- Extend native Chrome and Firefox checks and correct asynchronous polling in the browser test harness.

## 1.0.5

- Install browse redirects within Chrome's compiled regex budget. Match reserved paths and bypass values at their boundaries, and preserve custom destination hosts and ports.
- Show redirect installation status and errors in Settings and the popup. Remove stale rules after a failed update, and keep menu failures independent of redirect removal.
- Serialize settings writes across extension contexts. Preserve disabled custom entries, merge individual changes against current settings, and reject imported preset ID collisions.
- Keep native keyboard activation for dropdown buttons and return focus to the trigger on Escape.
- Confirm native copies only after the clipboard write succeeds. Preserve other clipboard formats and propagate write failures without retrying.
- Check only enabled redirectors, with one access request and at most three checks in flight. Omit credentials and referrers, and do not follow redirects during checks.
- Stop retaining failed-copy URLs and delete legacy retained data during startup and reset.
- Scan affected articles after DOM updates instead of scanning every tweet after unrelated changes.
- Recover tweet IDs when retargeting Thread Reader App and Unroll Now links.
- Preserve control selections while access requests are pending, and keep delayed status reads from replacing newer results.
- Add settings, clipboard, failure-recovery, and native Chrome and Firefox regression coverage.

## 1.0.4

- Fix the redirector menu closing as soon as you scrolled it, which made the thread tools and the footer buttons unreachable.
- Navigate the menu with the keyboard without the list closing partway down.
- Rebuild the context menus once per settings change instead of twice, with storage events as the single trigger.

## 1.0.3

- Serialize all startup and settings refreshes to prevent duplicate context-menu IDs during installation and updates.
- Wait for menu removal and creation to finish, report asynchronous errors, and recover on later refreshes.
- Cover overlapping events and failure recovery with Chrome and Firefox API regression tests.

## 1.0.2

- Add the Firefox data-collection declaration required for new AMO submissions.
- Build the in-page menu and SVG icons with DOM APIs instead of HTML strings, resolving Mozilla's three HTML assignment warnings.
- Retain the 1.0.1 fix for unresponsive X tabs in both browser packages.

## 1.0.1

- Fix an endless message exchange between content scripts that could make X tabs unresponsive while xIT was enabled, even with browse redirect off.
- Keep native copy-link conversion and settings updates working without restarting the message exchange.
- Include the fix in both Chrome and Firefox builds, with regression coverage for either content-script startup order.
