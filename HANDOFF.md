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
| In the repo | **1.0.4**, built, tested, not uploaded |

## Do this next

1. **Upload `dist/xit-chrome-1.0.4.zip`.** It contains two fixes that are not
   live: the redirector menu could not be scrolled at all, and every settings
   change rebuilt the context menus twice.
2. **Re-upload the five screenshots** from `store/assets/` on the Store listing
   tab. The live listing still has the pre-14 September images with em dashes
   burned into the captions. A listing edit gets a light review and needs no
   version bump.
3. **Firefox has never been submitted.** `dist/xit-firefox-1.0.4.zip` is ready
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

- `buildMenus` aborts partway if one `createMenu` rejects, leaving a truncated
  menu until the next refresh. This is a deliberate change from the earlier
  swallow-and-continue behaviour. It fails loudly, which is arguably right, but
  the user-visible result is a partial menu.
- The user-count badge is missing from the README because the store does not
  report a count for a listing this new. Worth adding once there are installs.
- The listing language is English (United States) while the copy is British
  spelling.

## Verifying a change

```bash
npm test              # 29 tests: URL rewriting, background menus, content bridge
npm run prepare-dist  # icons, both manifests, both zips
npm run store-assets  # re-render screenshots and promo tiles (needs Chrome)
```

Unit tests do not cover the in-page menu, which is where the last two user-
reported bugs were. For UI changes, mount `src/content/inject.js` against a mock
X DOM with stubbed `chrome.*` APIs and drive it in a browser. Both the scroll
bug and the message-loop bug were found and confirmed that way, not by reading.
