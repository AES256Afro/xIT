# Firefox Add-ons (AMO) submission copy

Paste-ready values for <https://addons.mozilla.org/developers/addon/submit/distribution>.
Upload: `dist/xit-firefox-1.0.6.zip`

---

## Before you can submit

- [ ] Create a Firefox Account and sign in to AMO. **No fee.**
- [ ] Decide listed vs unlisted (see below).
- [ ] Host the privacy policy publicly if you tick any data-collection box
      (you should not need to, since xIT collects nothing).

**Listed** puts it in the public directory and gives you a permanent install
link. **Unlisted** just signs the file and hands you a signed `.xpi` you can
install yourself and share directly, with no review queue and no public listing. For a
personal tool, unlisted is often the better trade.

Either way you get a signed build, which is what makes the add-on survive a
Firefox restart. The temporary-add-on route in `about:debugging` does not.

---

## Listing

**Name**
```
xIT
```

**Summary** (250 max, this is 230)
```
Copy X/Twitter links through the front-end you actually want. One click on the tweet, or X's own "Copy link". Both give you fxtwitter, xcancel, nitter, a thread unroller, or your own self-hosted instance. Optional page redirecting.
```

**Categories:** Privacy & Security, Social & Communication
**Tags:** twitter, x, nitter, fxtwitter, privacy, redirect
**Licence:** MIT
**Support site:** `https://github.com/AES256Afro/xIT`
**Support email:** *(your address, or leave blank and rely on the issue tracker)*

**Description**: AMO accepts limited HTML; plain text with blank lines is fine.
```
xIT rewrites X/Twitter links as you copy them, so the link you paste is the one you actually wanted.

Share a tweet in Discord or Slack and you get a dead grey box. Send someone a link and they hit a login wall. xIT fixes that at the point of copying. You pick the front-end once and stop thinking about it.

TWO WAYS TO COPY, SAME RESULT

• A button on every tweet. Click to copy with your default; click the chevron, right-click, or long-press to pick a different one for that copy.
• X's own "Copy link" is patched to hand you the rewritten URL too, with the native menu unchanged.

Plus a right-click menu on tweet links anywhere on the web, and Alt+Shift+C for the tweet under your pointer.

BUILT IN

Embed fixers: fxtwitter, fixupx, twittpr, vxtwitter, fixvx, d.fxtwitter.
Privacy front-ends: xcancel, twiiit, nitter.net, nitter.poast.org, nitter.privacydev.net.
Thread tools: Thread Reader App, Unroll Now.
Custom: any self-hosted instance, via a live-validated URL template.

xIT also strips the ?s=20&t=… share telemetry X appends to copied links.

OPTIONAL: SKIP X ENTIRELY

Off by default. When enabled, x.com page loads are redirected before the request leaves your browser, scoped to tweets, profiles or everything. Your timeline, DMs, notifications and settings are never redirected. Choose Open on X once to reach the original page. Pause redirects for 15 minutes or resume early whenever you need to.

EVERYDAY CONTROLS

Pin your favourite redirectors and reorder them in Settings. Edit or duplicate a custom instance and undo its removal. Paste a link in the popup and press Enter to copy. Check one enabled host or all of them, with the time of each check shown. Copy diagnostics for troubleshooting without including personal URLs, custom templates or clipboard contents.

PRIVACY

No analytics, no telemetry, no accounts, no remote code, no network requests of its own except an optional reachability check you trigger by hand. Settings stay on your device.

Open source, MIT licensed: https://github.com/AES256Afro/xIT

Note: public Nitter instances go dark without warning. Settings includes a reachability check, and you can switch or add your own instance at any time.
```

---

## Privacy and review notes

**Does your add-on collect or transmit user data?** No.

**Notes for the reviewer**: paste this, since it answers the questions AMO reviewers
actually ask about this kind of add-on:
```
Source is unminified and unbundled; what you see in the package is what runs. No build step is needed to review it, and no remote code is loaded or executed.

Repository: https://github.com/AES256Afro/xIT

Implementation details for reviewers:

1. content/main-world.js runs in the page's own context (world: "MAIN") for one reason: to wrap navigator.clipboard.writeText and .write so that X's native "Copy link" produces the user's chosen redirected URL. It holds no extension privileges, communicates only via window.postMessage, and modifies a string only when that string is a lone X/Twitter status URL. Prose, plain text and unrelated URLs are passed through untouched. The user can turn it off in Settings.

2. optional_host_permissions is "*://*/*" but nothing is granted at install. Enabling page redirecting requests the selected destination host (e.g. https://xcancel.com/*), including custom instances. Starting the optional reachability check requests access to the enabled redirector hosts together. Disabled hosts are excluded. Check requests omit credentials and referrers and do not follow redirects.

3. The alarms permission resumes page redirects after a user-requested pause. storage.session keeps the last removed custom entry for Undo; it is cleared on browser restart. Diagnostics are generated and copied only on request, exclude user URLs and templates, and are never sent by the extension.

Settings are stored with storage.local and never transmitted. The only outbound request the add-on can make is the optional "check which are reachable" button on the Settings page, which the user must press.
```

**Version notes (1.0.6)**
```
Add Open on X once, pinned redirector ordering, custom editing and duplication with Undo, Enter-to-copy, timed redirect pauses, individual host checks with check times, and diagnostics without personal links or clipboard data. Includes the 1.0.5 correctness, performance, and privacy fixes.
```

---

## Graphics

AMO has no fixed screenshot dimensions; the 1280×800 files work as-is.

| Field | File |
|---|---|
| Icon | `src/icons/icon-128.png` |
| Screenshots | `store/assets/screenshot-1…5-*.png` |

---

## Things specific to Firefox

- **`browser_specific_settings.gecko.id` is `xit@aes256afro.github.io`.** This is the
  add-on's permanent identity on AMO. Once a version is submitted under it you
  cannot change it without losing update continuity, and AMO will reject a
  different add-on reusing it. If you would rather it read as a real domain you
  control, change it in `tools/build.mjs` **before** the first submission.
- **Minimum version is Firefox 128**, because the clipboard patch uses a
  `world: "MAIN"` content script. Below that the add-on still works through its
  DOM fallback, but the manifest floor keeps the experience predictable.
- **MV3 host permissions are opt-in on Firefox.** After installing, the user
  must grant access to x.com, and the popup has a button for it. This is normal
  Firefox behaviour, not a bug; it is worth a line in your listing if you
  publish it listed.
