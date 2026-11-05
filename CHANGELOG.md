# Changelog

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
