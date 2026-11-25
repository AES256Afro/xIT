# Changelog

## Unreleased

- The right-click menu on selected text can copy every tweet link in it at once, one per line, each converted with your default. A link that appears twice, or on both twitter.com and x.com, is copied once.
- Making a redirector the default from the tweet menu now offers Undo in the banner that confirms it, since one click there changes a setting that applies everywhere.
- On Firefox, redirectors that only work with a tweet, such as Thread Reader App, are hidden from the right-click menu on a profile and other pages that are not tweets.

- The right-click menu now also appears on links that are already on a redirector, a thread reader or a front-end xIT no longer offers, so you can switch such a link to your default or open it on X. Links to your own custom redirectors count too.
- Replacing all your settings from a file can be undone. The Backup panel offers to put back what you had, until the browser restarts, you import again, or you reset.
- Exported settings files are named with the version and the date, so backups no longer overwrite each other.
- The popup shows the diagnostics report it copies, as Settings does, so you can see it holds no links before pasting it anywhere.
- The popup's Make default star is drawn like every other icon instead of being a text character.

- The right-click menu is no longer rebuilt every time the browser wakes xIT in the background, which it does every half minute or so of idleness. Chrome keeps the menu across those restarts, so the rebuild was repeated work, and a right-click at that moment could find the menu half built. The one-time cleanups left over from old versions also run once per browser session now instead of on every wake.
- The package no longer includes an unused 512-pixel icon.

- The copy confirmation and error banners on X are easier to read. White text sat on a blue and a red that fell short of the contrast needed for text that size; both are darker now.
- Screen readers announce the first banner on a page too. The announcement area used to be created at the same moment as its first message, which screen readers tend to miss; it now exists from the start.
- Settings shows the keyboard shortcuts the browser actually has, instead of the suggested ones. A suggested key that clashes with another is dropped at install without a word, and Settings used to show it anyway. A shortcut you set yourself now appears too, and the panel updates when you come back from the browser's shortcuts page.
- A right-click copy that fails on a page xIT cannot run on, such as a browser settings page, now marks the toolbar button with a red "!" for a few seconds, and its tooltip says the copy did not happen. It used to fail silently and leave the clipboard as it was.
- Errors in the popup stay until something replaces them, instead of disappearing after a couple of seconds. Confirmations still clear themselves.
- The copy shortcut works straight after a page loads. Pressed before xIT had finished starting up on that tab, it used to do nothing.
- If a setting cannot be saved, Settings and the popup now say so, and a popup switch goes back to what is actually saved. Reset to defaults used to fail silently.
- The Copy address button in Settings no longer keeps its focus outline after copying.
- A custom template can no longer put a token in the host, such as `https://{user}.example.com/{id}`. The host is the site your links are sent to, so it is fixed; tokens belong in the path, query or fragment. A custom redirector you already have with a token in its host is removed on upgrade, as any template that fails validation is.
- Web pages can no longer ask xIT to change more than the two settings the tweet menu needs: pins and the default redirector. Settings and the popup are unaffected.

## 1.4.1

- Choosing redirectors no longer switches off the ones you added yourself. Saving the "Choose your redirectors" dialog rebuilt your list from the entries it shows, which are only the ones xIT bundles or catalogues, so every custom redirector was turned off and a custom default was replaced with FxTwitter. Your own entries, your default and your pins now stay as they were.
- Only a tweet or a profile is converted. Any other X address, such as Home, a search, a list, a community, a Space or a message thread, used to come out as a broken redirector link with a "Copied" confirmation. That reached X's own Copy link on those pages, the tweet button when it could not find the tweet's link, and the popup. Those links now stay exactly as X wrote them, and the popup says the page cannot be converted instead of offering a Copy that does nothing useful.
- "Open with" in the right-click menu no longer replaces your clipboard. When the redirector could not take the link, for example a thread reader on a profile, it copied the x.com link instead of opening anything. It now opens nothing, copies nothing, and on X says why.
- Turning off "Confirm copies with a toast" now hides confirmations only. It also used to hide the message that a copy failed, and the one saying a different link was copied than the one you asked for.
- X's own Copy link now works with a custom default in every language X offers. It used to find X's menu item by the English words "Copy link", so on X in any other language a custom default quietly left the plain x.com link on the clipboard. The copy is now recognised from X's clipboard call itself, and is finished only right after a real click, so a script on the page cannot trigger it.
- Check in Settings no longer reports vxTwitter or FixVX as not answering. Their front pages redirect elsewhere (vxTwitter's to github.com), the check followed the redirect to a site it had no permission for, and the browser refused the answer. A redirect is now counted as an answer and is not followed, so the check only ever contacts the redirector itself, as the privacy policy says.
- Duplicating a custom redirector with a long name no longer produces a second entry with exactly the same name. The original name is shortened to make room for "copy" rather than the word being cut off.
- The few remaining English phrases in Settings, such as the "becomes" preview line, the "default" badge and the pin buttons in the redirector picker, now come from the translation catalogue like everything else, and a test stops new ones from being added.

## 1.4.0

- Selected text can now be converted from the right-click menu. A tweet URL that sits in a page as plain text, which is how they arrive in a mailing-list archive, a code block or a pasted quote, had no route but the popup's paste field. Select it, right-click, and the xIT menu offers everything it offers on a real link. The first tweet URL in the selection is the one used.
- The popup's paste field reads a tweet URL out of surrounding text too, so a whole line copied from a mail or a chat works as well as a bare link.
- On an X page, a selection that turns out to hold no tweet URL now says so instead of leaving the clipboard holding whatever it held before. Off X there is no toast to show, so nothing is copied and nothing is said.

## 1.3.9

- Typing in the Settings redirector filter and in the popup's paste field no longer redraws the whole list for each character. Filtering now hides the rows that do not match rather than rebuilding every row, its buttons and its reachability badge, and the popup builds its rows once and rewrites only the line that the link you pasted decides. Nothing looks different; both lists simply stop doing work that could not change anything, which matters as the number of redirectors grows.

## 1.3.8

- The Reset to defaults dialog now reads the defaults rather than stating them. It told you "three redirectors enabled, FxTwitter as the default", which was a sentence somebody had typed out: correct today and quietly wrong the first time the bundled set changed. It is now filled in from the defaults a reset actually applies.

## 1.3.7

- Reachability results are tidied up after themselves. A redirector you remove now takes its Check result with it instead of leaving a badge for something that is no longer there, and Reset to defaults clears the results along with everything else. Disabling a redirector still keeps its result, since you can tick it back on and the result is about the same host either way.

## 1.3.6

- Clicking Check twice while the permission prompt is up no longer starts two checks. The buttons are now disabled for as long as the prompt is open, which is the honest state: the check has begun, it is waiting on your answer.

## 1.3.5

- The copy format now applies to the x.com link as well. If you had chosen "Markdown link" or "Author then link", "Copy as FxTwitter" honoured it and "Copy x.com link" sitting next to it did not, and nor did the right-click menu's x.com item or the link you are given when a redirector does not apply to what you right-clicked. All four write the format you chose. The handle is already in an x.com path, as it is in a mirror's, so "Author then link" repeats it there in the same way it always has.

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
