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
| Firefox add-on ID | `xit@aes256afro.github.io` (permanent once submitted) |
| Published | Chrome **1.0.3** |
| In the repo | **1.4.0**. Versions 1.0.4 to 1.4.0 are built and committed; none has been uploaded. |

## Do this next

1. **Run the three browser suites on the host, before anything else.**

   ```bash
   npm i && npm run test:browser && npm run test:firefox && npm run test:qol
   ```

   They need Playwright, which the sandboxed development environment does not
   have, so they have not run against any build since 1.0.3. That is every
   version from 1.0.4 to 1.4.0, including all of the context menu trees, the
   toast, and the popup and Settings render paths rewritten in 1.3.9 and 1.4.0.
   The 153 unit tests are a hand-written harness: they prove the logic agrees
   with itself, not that Chrome and Firefox agree with it. This is the only
   item here that can actually fail, so it goes first.

2. **Re-render the screenshots**, then upload them on the Store listing tab.

   ```bash
   npm run store-assets   # needs a real Chrome on the host
   ```

   The four images in `store/assets/` predate every control added since 1.1.0,
   so the live listing shows a version of xIT that no longer exists. A listing
   edit gets a light review and needs no version bump.

3. **Upload `dist/xit-chrome-1.4.0.zip`.** It supersedes the unuploaded 1.0.4
   to 1.3.9 packages. Since the live listing is 1.0.3, the changes a reviewer
   sees are the whole span: the Nitter-based front-ends withdrawn after a cease
   and desist, page redirecting removed along with the `alarms` permission, and
   everything added since. Check the listing fields against
   [store/chrome-web-store.md](store/chrome-web-store.md) rather than assuming
   they are current: every one of them was written for 1.0.3. The single-purpose
   field is the one most likely to read as a mismatch, because the extension now
   also converts selected text, reads a link out of pasted prose, checks host
   reachability, and keeps a user-editable redirector list.

4. **Firefox has never been submitted.** The package is `dist/xit-firefox-1.4.0.zip`
   and the copy is in [store/firefox-amo.md](store/firefox-amo.md). No fee.
   Unlisted skips the review queue if a signed build for personal use is all
   that is wanted.

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
after a release carrying that cleanup has actually been *published*. The live
listing is 1.0.3, which is what installed the rules, so nothing published has
ever run the cleanup. Drop the permission before then and anyone on 1.0.3 with
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
  It is the only finding of either audit sweep still open.

## Verifying a change

```bash
npm test              # 153 tests: URL logic, settings writes, menus, clipboard, both page render paths
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

**The 1.4.0 build has passed unit tests only: 153 of them, all on Node.** None
of the three browser suites has run against it, or against any build since
1.0.3, because Playwright is not installed in the sandboxed environment this
work is done in and Firefox cannot spawn its content processes there either.
Treat all three as unverified from 1.0.4 onward and run them on the host.

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

The public version badge still reports 1.0.3: versions 1.0.4 to 1.4.0 were
built but never uploaded. Store upload and publication are separate from the
checked-in version and package build, so the badge lagging is expected and is
not a sign that a build or a commit failed.
