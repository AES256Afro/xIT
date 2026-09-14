# xIT handoff

State as of 14 September 2026. This covers the things that are *not* in the
code or the other docs: current status, decisions already made and why, and the
traps. For how the extension works and how to build it, read the
[README](README.md). For store fields, read [store/SUBMISSION.md](store/SUBMISSION.md).

## Where things are

| | |
|---|---|
| Repo | <https://github.com/AES256Afro/xIT> (public) |
| Working copy | `/Users/chris/Projects/xIT` |
| Chrome listing | <https://chromewebstore.google.com/detail/xit/clilllbfkoeamfonhoeaaepglgceanlc> |
| Chrome item ID | `clilllbfkoeamfonhoeaaepglgceanlc` |
| Firefox add-on ID | `xit@aes256afro.github.io` (permanent once submitted) |
| Published | Chrome **1.0.3** |
| In the repo | **1.0.5**, audit fixes; see validation below. Not uploaded. |

## Do this next

1. **Upload `dist/xit-chrome-1.0.5.zip` after reviewing the release checks.**
   This replaces the unuploaded 1.0.4 package. It fixes the audit findings in
   [AUDIT-2026-09-14.md](AUDIT-2026-09-14.md), including Chrome rejecting browse
   rules, lost settings writes, keyboard actions, request scope, and failed-copy
   data retention. It also includes the 1.0.4 scrolling and menu-refresh fixes.
2. **Re-upload the five screenshots** from `store/assets/` on the Store listing
   tab. The live listing still has the pre-14 September images with em dashes
   burned into the captions. A listing edit gets a light review and needs no
   version bump.
3. **Firefox has never been submitted.** The package is `dist/xit-firefox-1.0.5.zip`
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
`christopher.courtney@protonmail.com`; everything else uses
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

**Public Nitter instances rot.** The bundled list was accurate at release and
will not stay that way. Settings has a reachability check, but it only proves
the host answered, not that it still renders tweets.

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

**`*://*/*` in `optional_host_permissions` stays.** It triggers an in-depth
review banner, but nothing is granted at install, and it is what allows a custom
self-hosted instance to be used as a page-redirect target. Removing it would
also break page redirecting for the bundled redirectors unless replaced with an
explicit host list, because `permissions.request()` can only ask for origins
already declared in the manifest.

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

## Verifying a change

```bash
npm test              # 47 tests: URL logic, settings writes, menus and clipboard
npm run prepare-dist  # icons, both manifests, both zips
npm run test:browser  # native Chrome API and UI checks; needs Playwright/Chromium
npm run test:firefox  # native Firefox installation, settings, menus and rules
npm run store-assets  # re-render screenshots and promo tiles (needs Chrome)
```

`tools/test-browser.mjs` loads the built extension in a disposable Chrome profile.
Set `PLAYWRIGHT_PATH` to an external Playwright `index.mjs` when it is not locally
installed, and optionally `CHROME_PATH` to a Chromium/Chrome for Testing binary.
The checks use native extension APIs and mock X documents. They include regex
compilation, installed rules, settings from separate pages, permission denial,
error display, keyboard controls, scrolling, and article lifecycle changes.

The 1.0.5 build passed native checks in Chrome for Testing 151.0.7922.34 and
Firefox 154.0.1. Both installed all 40 rules for the default tweet/profile
configuration. Firefox's check uses WebDriver BiDi and Node 22 or later; set
`FIREFOX_PATH` if needed. It validates native settings messages, menu creation,
rule installation and removal, and status display. See the audit for the full
validation record and remaining coverage limits.

At the end of the fix pass, the Chrome regression workload recorded zero full-
document scans for 60 unrelated mutations at 50, 200, and 1,000 mounted tweets.
The earlier audit recorded 31 scans for each workload. This is a synthetic DOM
measurement, not an authenticated live X performance claim.

The public version badge still reported 1.0.3 before the 1.0.5 bump. Store upload
and publication are separate from the checked-in version and package build.
