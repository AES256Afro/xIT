# Changelog

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
