# xIT handoff

State as of 6 November 2026. This covers the things that are *not* in the
code or the other docs: current status, decisions already made and why, and the
traps. For how the extension works and how to build it, read the
[README](README.md). For store fields, read [store/SUBMISSION.md](store/SUBMISSION.md).

## Where things are

| | |
|---|---|
| Repo | <https://github.com/AES256Afro/xIT> (public) |
| Working copy | `~/Projects/xIT` |
| Chrome listing | <https://chromewebstore.google.com/detail/xit/clilllbfkoeamfonhoeaaepglgceanlc> |
| Chrome item ID | `clilllbfkoeamfonhoeaaepglgceanlc` |
| Firefox listing | <https://addons.mozilla.org/firefox/addon/xit/> |
| Firefox add-on ID | `xit@aes256afro.github.io` (permanent) |
| Published | Chrome **1.4.0**, updated 9 November 2026. Firefox **1.0.6**, public since 14 September 2026. Checked 25 November 2026. |
| In the repo | **1.4.1**. Built into `dist/`, not uploaded to either store. |

## Do this next

1. **Upload 1.4.1 to Firefox first.** The public Firefox version is 1.0.6,
   which still offers the Nitter-based front-ends withdrawn in 1.0.7 after a
   cease and desist, and still redirects page loads for anyone who turned
   that on. Upload `dist/xit-firefox-1.4.1.zip` as a new version of the
   existing listing. The release notes and reviewer notes are in
   [store/firefox-amo.md](store/firefox-amo.md); the reviewer sees the whole
   span from 1.0.6, so paste the implementation notes in full.

2. **Upload 1.4.1 to Chrome.** Upload `dist/xit-chrome-1.4.1.zip`. On the
   Privacy practices tab, replace the single-purpose field with the text in
   [store/chrome-web-store.md](store/chrome-web-store.md): the live one still
   describes page redirecting, which was removed in 1.0.7.

3. **Check the store images.** `store/assets/` was rendered from 1.4.0 on 6
   November 2026 and still matches the UI. If either listing still shows older
   images, upload these. A listing edit gets a light review and needs no
   version bump. To render them again after a UI change:

   ```bash
   npm run store-assets   # needs a real Chrome on the host
   ```

   The tool drives Chrome over its DevTools protocol. It used to use Chrome's
   own `--screenshot` flag, and in Chrome 156 that captured the content
   script's open menu as nothing at all while the DOM said it was open and
   visible; the live capture does not have that gap.

4. **Once Firefox 1.4.1 is live, read S5 below again.** It is the condition
   for retiring `declarativeNetRequest`, and Firefox is what still holds it.

## Traps

**Two sessions worked on this repo at once on 13 September and it caused a
version collision.** One published 1.0.1 through 1.0.3 while the other was
preparing its own 1.0.1. Chrome will not accept a version number twice, even
from a rejected submission. Before bumping, check what is actually live:

```bash
curl -s "https://img.shields.io/chrome-web-store/v/clilllbfkoeamfonhoeaaepglgceanlc" | grep -o '<title>[^<]*</title>'
```

**Git history contains two identities.** Commits from 13 September are authored
under a personal address; everything else uses
`AES256Afro@users.noreply.github.com`. A deliberate scrub on 12 September
removed a personal name and email from the repo and its history. If you work
from a different machine, set this before committing:

```bash
git config user.email "AES256Afro@users.noreply.github.com"
```

**The "not trusted by Enhanced Safe Browsing" install warning is not a defect.**
Google treats new developers as untrusted and says it "generally takes a few
months to become trusted". Nothing in the manifest, permissions or listing
changes it. Do not go hunting for a fix, and do not unpublish and resubmit,
which would only reset the clock.

**Public front-ends can be shut down, not just go offline.** The Nitter-based
group was withdrawn in 1.0.7 after a cease and desist. Links from those hosts
are still *read*, so xIT can convert them to something it does offer, but
nothing sends a user to them. If another bundled service goes the same way, the
removal pattern is that commit.

**`declarativeNetRequest` installs no rules, but it is not unused.** It is what
lets `clearLegacyRedirects` delete the rules earlier versions left on users'
machines, and dynamic rules survive extension updates. The condition for
dropping it is not a version number or a waiting period: it can go one release
after a release carrying that cleanup has actually been *published*, in both
stores. Chrome's 1.4.0, published on 9 November 2026, carries it. Firefox's
published 1.0.6 installed rules and has never run it, and one package builds
both, so the permission stays until a Firefox release with the cleanup is
live, and then one release more. Drop it before then and anyone on 1.0.6 with
redirecting enabled keeps being sent to a front-end xIT no longer offers, with
no setting left to turn it off, because the feature itself is gone. A sweep for
unused permissions will flag this; it is wrong. Recorded as S5 in
[AUDIT-LOOP.md](AUDIT-LOOP.md). Delete `clearLegacyRedirects` with the
permission, in that later release.

**Embed fixers bounce browsers back to x.com.** fxtwitter, fixupx and twittpr
answer a real browser with a 302 to x.com, and vxtwitter does it with a meta
refresh. That is why page redirecting had no bundled destination left once the
Nitter group went, and why reviving it would need a destination that serves
pages to browsers.

**The in-tweet button depends on X's DOM.** If it vanishes after an X redesign,
`isTweetActionBar` in `src/content/inject.js` is the thing to fix. The native
"Copy link" patch does not depend on the DOM and keeps working meanwhile.

## Decisions already made

**Do not add features outside X link rewriting.** The Chrome listing declares a
single purpose, and that is enforced at review. A YouTube tracking-parameter
stripper was considered on 13 September and rejected for this reason: it is a
different product sharing a mechanism, and it would have put the listing at risk
during the trust-building window. If that feature is still wanted, ship it as a
separate extension. Most of this repo is reusable for one.

**`optional_host_permissions` is an explicit host list, not `*://*/*`.** It was
the broad pattern while page redirecting existed, for custom self-hosted
targets. Page redirecting went in 1.0.7, and the list is now the eight origins
in `XIT.CHECK_ORIGINS`, derived in `tools/build.mjs` from the bundled
redirectors. Nothing is granted at install: the Settings page asks for one
origin only when the user presses Check, which is the sole reason the list
exists. It has to stay declared, because `permissions.request()` can only ask
for origins already in the manifest, so a reachability check against a
redirector absent from this list cannot be offered at all.

**No em dashes**, anywhere: docs, listing copy, UI strings, screenshot captions.
Rewrite the sentence rather than substituting another dash. This was an explicit
request and the repo was swept for it on 12 September.

**Store screenshots are generated from the real UI** by `npm run store-assets`,
which drives headless Chrome over the actual popup, options page and content
script with only the extension APIs stubbed. Do not hand-edit anything in
`store/assets/`; change the source and re-render, or the images will drift from
what ships.

## Open, deliberately not done

- `buildMenus` still aborts if a menu creation call rejects. The error is
  recorded as `menuError`, and a later refresh can recover. Redirect updates
  and removal now run independently, so this cannot leave redirects active
  just because menu creation failed.
- The user-count badge is missing from the README because the store does not
  report a count for a listing this new. Worth adding once there are installs.
- The listing language is English (United States) while the copy is British
  spelling.
- **The U4 ARIA fix has never been through a screen reader.** The content-script
  menu rows became a `role="group"` of `role="menuitem"` buttons in 1.1.0, and
  there are unit and Playwright assertions on the structure, but structure is
  not the same as being usable. Not a review blocker; an untested claim.
- **C12 is the last inline English a user can read.** The eleven failure
  messages `convert()` and `validateTemplate()` return cannot move into
  `_locales` the way the rest did, because `src/lib/redirectors.js` has to stay
  free of browser APIs: `tools/build.mjs` evaluates it in a bare context and the
  unit tests load it alone. Moving them means returning a message code plus
  parameters, a library-contract change with roughly twenty assertions on it.

## Open findings

The one status list. AUDIT-LOOP.md is the history of the first audit; this
is what is still open from it and from the eight-stage audit of 25 November
2026. Severities are that audit's. Closed so far from the second audit: B12
to B21, C14 to C19, D1, O6, P6, P10, Q7, Q8, Q10, Q13, U12, U13, U15, U16, V1,
S7 to S9, R1 to R5, and Q9 and P7 with them. D5 needed no change: the badge
reads "Cannot be checked" with a tooltip saying why, which is accurate. B22 needed no change: the menu rebuild in diagnostics is the
probe that makes the report's menu status current, and is commented as such.

| Next | ID | Sev | What is open |
|---|---|---|---|
| Publish (M4) | | | 1.4.1 is built. Upload it to Firefox, then Chrome, and correct Chrome's single-purpose field. |
| Needs a person (M5) | U4, U13 | | One pass with VoiceOver or NVDA over the tweet menu, the popup and Settings. The structure is tested; whether it is usable by ear never has been. |
| M7, needs a design call | D2 | Medium | The tweet button is an unlabelled arrow next to X's own Share icon. A new mark is a visual decision, best made looking at live X. |
| M7, needs a design call | D3, D4 | Low | The toast may stack with X's own "Copied" toast (not seen on live X); the popup rows are crowded. |
| M7 | P8, P9 | Low | Convert every link in a selection; hide tweet-only redirectors on profiles (Firefox's `menus.onShown`). |
| M7 | P11 | Low | Choose the copy format at copy time. Shift-click was the proposal, but Shift and Alt already open the tweet menu, so it needs another gesture. |
| M7 | Q11, Q12 | Low | Opt-in sync, which needs a PRIVACY.md change; undo for Make default from the tweet menu. |
| M7 | U9 | Low | From the first audit: pinning is explained in prose and never prompted. |
| After Firefox 1.4.1 is live | S5 | | Drop `declarativeNetRequest` and `clearLegacyRedirects` one release after the cleanup is live in both stores. |
| Unscheduled | C12 | | The converter's own failure messages are still inline English. |

Q3 from the first audit, Undo ending at browser restart, is deliberate and
documented in the README, so it is not listed.

## Verifying a change

```bash
npm test              # 209 tests: URL logic, settings writes, menus, clipboard, both page render paths, every copy route, the package
npm run check         # every script parses
npm run prepare-dist  # icons, both manifests, both zips
npm run test:browser  # native Chrome API and UI checks; needs Playwright/Chromium
npm run test:firefox  # native Firefox installation, settings, menus and rules
npm run test:qol      # pins, custom edits, undo, Open on X and diagnostics
npm run store-assets  # re-render screenshots and promo tiles (needs Chrome)
```

`tools/test-browser.mjs` loads the built extension in a disposable Chrome profile.
Set `PLAYWRIGHT_PATH` to an external Playwright `index.mjs` when it is not locally
installed, and optionally `CHROME_PATH` to a Chromium/Chrome for Testing binary.
The checks use native extension APIs and mock X documents. They include regex
compilation, installed rules, settings from separate pages, permission denial,
error display, keyboard controls, scrolling, and article lifecycle changes.

**The browser suites last ran on 25 November 2026, and all pass** against the
code on `main` (1.4.0 plus the Unreleased fixes). There is no Playwright in
this repo. Point the suites at any local install, and at a Chromium it has
cached if its own revision is missing:

```bash
export PLAYWRIGHT_PATH=/path/to/node_modules/playwright/index.mjs
export CHROME_PATH="$HOME/Library/Caches/ms-playwright/chromium-<rev>/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
npm run build && npm run test:browser && npm run test:qol && npm run test:firefox
```

They cannot run inside a sandboxed agent shell: Chromium is refused its
crash handler and profile lock there, and Firefox its content processes.
None of them exercises X's real share menu, so the native Copy link fixes
(B13, B17) are proven by the unit suite only.

**`npm run build` deletes every zip in `dist/` before it builds**, including
`--no-zip` runs. A test build therefore removes a package waiting to be
uploaded. Build elsewhere with `XIT_DIST=/some/folder npm run build`, which is
what the package test does, or copy the zips aside first, or rebuild them
from the tagged commit.

**CI runs on GitHub, not here.** `.github/workflows/test.yml` first ran on
25 November 2026: the unit job passed and the Chrome job failed at install,
because `ubuntu-latest` had moved to 26.04, where Playwright 1.59.1 cannot
install Chromium. Both jobs are now pinned to `ubuntu-24.04`; that fix had not
run when this was written. It runs the syntax check, the unit suite, the catalogue check, and
the Chrome and QoL suites. The Firefox suite needs a desktop Firefox.

**The weekly redirector check** is `.github/workflows/redirectors.yml`,
Mondays, and can be started by hand from the Actions tab. It runs
`tools/check-redirectors.mjs`, the same HEAD-per-host check Settings makes, and
opens an issue titled "A bundled redirector stopped answering", or comments on
the open one, when a host fails. It had not run on GitHub when this was
written; the script itself was run by hand and all eight hosts answered.

**Menus on a woken worker.** Chrome keeps context menus across service worker
restarts, so a woken worker leaves them alone when the signature it stored in
`storage.session` still matches. That reliance is on Chrome's documented
behaviour and is not exercised by any suite, since none can restart the
worker. If right-click menus ever go missing in Chrome after a while idle,
this is the first place to look. Firefox rebuilds on every start.

What they covered when they last ran, which is worth knowing before reading a
failure: the Chrome checks install a redirect rule the way earlier versions
did, then use Chrome's own `testMatchOutcome` to confirm an x.com link is no
longer redirected after startup cleanup, with the menu rebuild deliberately
failing. Deleting the rule removal makes those checks fail, so they are not
vacuous. The Firefox script has been updated several times since it last ran.

The unit suite does bite. Every fix since 1.3.0 was checked by reverting it and
confirming the matching test failed, which is how three harness defects were
found: stubs that silently answered nothing. The most recent, in 1.4.0, was a
`chrome.runtime.onMessage.addListener` stub that had never delivered a message
to the content script.

Pins and defaults remain separate. Undo retains only the last removed custom
entry in `storage.session`, so it survives closing Settings but ends at browser
restart, import, reset, undo, or another removal. Neither manifest requests
`alarms`, clipboard-read, or history. Optional host permissions are declared,
as the list above describes, and none is granted at install.

At the end of the fix pass, the Chrome regression workload recorded zero full-
document scans for 60 unrelated mutations at 50, 200, and 1,000 mounted tweets.
The earlier audit recorded 31 scans for each workload. This is a synthetic DOM
measurement, not an authenticated live X performance claim.

The public version badge reports what Chrome has published, which on 25
November 2026 was 1.4.0. Upload and publication are separate from the
checked-in version and the package build, so the badge lagging behind the
repo is expected and is not a sign that a build or a commit failed. Firefox's
published version can be read from
`https://addons.mozilla.org/api/v5/addons/addon/xit@aes256afro.github.io/`.
