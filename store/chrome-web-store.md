# Chrome Web Store submission copy

Paste-ready values for every field in the Developer Dashboard.
Upload: `dist/xit-chrome-1.0.5.zip`

---

## Before you can submit

- [ ] Register a developer account at <https://chrome.google.com/webstore/devconsole>. **One-time US$5 fee**, paid by you, non-refundable.
- [ ] Host the privacy policy at a public URL. Simplest: push this repo and use
      `https://github.com/AES256Afro/xIT/blob/main/PRIVACY.md`.
- [ ] Verify your email in the dashboard, or the listing cannot be published.

---

## Store listing

**Name** (45 max)
```
xIT
```

**Short description** (132 max, this is 111)
```
Copy X/Twitter links through fxtwitter, xcancel, nitter or your own instance. One click, or X's own Copy link.
```

**Category:** Productivity
**Language:** English (United Kingdom)

**Detailed description**
```
xIT rewrites X/Twitter links as you copy them, so the link you paste is the one you actually wanted.

Share a tweet in Discord or Slack and you get a dead grey box. Send someone a link and they hit a login wall. xIT fixes that at the point of copying. You pick the front-end once and stop thinking about it.

TWO WAYS TO COPY, SAME RESULT

• A button on every tweet. Click it to copy with your default. Click the chevron (or right-click, or long-press) to pick a different one just for that copy.
• X's own "Copy link". xIT patches it so the native share menu hands you the rewritten URL too. The menu looks and behaves exactly as before, so your muscle memory still works.

Also: a right-click menu on any tweet link anywhere on the web, and Alt+Shift+C for the tweet under your pointer.

WHAT'S BUILT IN

Embed fixers: fxtwitter, fixupx, twittpr, vxtwitter, fixvx, and d.fxtwitter for the media file itself. These make tweets unfurl properly, with video and multi-image galleries, in Discord, Slack and Signal.

Privacy front-ends: xcancel, twiiit, nitter.net, nitter.poast.org, nitter.privacydev.net. Read without the tracking or the login wall.

Thread tools: Thread Reader App and Unroll Now, for turning a 40-post thread into one readable page.

Your own: add any self-hosted instance with a simple template. Tokens are {path}, {query}, {user}, {id}, {hash} and {host}, validated live as you type, with a worked example shown before you save.

TIDIER LINKS

xIT strips the ?s=20&t=… share telemetry X appends to copied links, while leaving real parameters alone. You can turn that off.

OPTIONALLY, SKIP X ENTIRELY

Off by default. Turn on "Redirect page loads" and visiting x.com sends you straight to your chosen front-end, before the request leaves your browser. Scope it to tweets, profiles, or everything. Your own timeline, DMs, notifications, bookmarks and settings are never redirected, because a front-end cannot show them and you would just be locked out. Your logged-in session is untouched; you simply stop landing on it. Append ?xit_bypass=1 to any URL to reach x.com anyway.

PRIVACY

No analytics. No telemetry. No accounts. No remote code. xIT makes no network requests of its own except the optional "check which are reachable" button, and only when you press it. Settings stay in your browser. Rewriting a link is local text manipulation.

Open source, MIT licensed: https://github.com/AES256Afro/xIT

A NOTE ON PUBLIC INSTANCES

Nitter instances go dark without warning. That is the nature of them, not a fault in xIT. Settings has a reachability check, and you can switch your default or add your own instance at any time.
```

---

## Privacy practices tab

**Single purpose**
```
xIT rewrites X/Twitter (x.com and twitter.com) links to equivalent URLs on an alternative front-end chosen by the user, when the user copies a link, opens a context menu, or optionally, navigates to x.com.
```

**Permission justifications**, one per permission, all required fields:

| Permission | Justification |
|---|---|
| `storage` | Stores the user's own settings: which redirector is the default, which are enabled, custom URL templates, and copy/redirect preferences. Local only; never transmitted. |
| `contextMenus` | Adds the right-click menu that lets the user copy or open a tweet link through a chosen redirector. |
| `activeTab` | When the user picks an item from the right-click menu, the rewritten URL must be written to the clipboard in the page they clicked in. activeTab grants that access for that click only, rather than standing access to every site. |
| `scripting` | Used solely with activeTab to run a short clipboard-write function in the tab the user just invoked the context menu in. No code is injected at any other time, and no remote code is ever executed. |
| `declarativeNetRequest` | Implements the optional "redirect page loads" feature. Rules are declared to the browser, which evaluates them itself; the extension never observes or receives the user's browsing. |
| `clipboardWrite` | The extension's entire purpose is putting a rewritten link on the clipboard. |
| Host permissions for `x.com` / `twitter.com` | Needed to place the copy button in the tweet action bar, read the tweet's permalink, and rewrite the link X's own "Copy link" produces. These are the only sites the extension's content scripts run on. |
| Optional host permissions (`*://*/*`, not granted by default) | Nothing is granted at install time. Enabling page redirecting requests the selected destination host (for example `https://xcancel.com/*`), including custom instances. Starting the optional reachability check requests access to the enabled redirector hosts together. Disabled hosts are excluded. Requests use HTTPS, omit credentials and referrers, and do not follow redirects. |

**Are you using remote code?** Select **No**. The dashboard still requires a
written justification, and blocks submission without one. Paste:

```
xIT does not use remote code. Everything that executes ships inside the package: there are no externally hosted scripts, no CDN or remote module imports, no eval() or new Function(), and no string-based code execution anywhere in the extension. The service worker's importScripts() call loads only two files contained in this package (lib/redirectors.js and lib/storage.js). The single main-world content script (content/main-world.js) is likewise a static file in the package, declared in the manifest. The extension's only possible outbound request is an optional reachability check that the user starts by pressing a button on the Settings page; it is a no-cors HEAD request whose response is never read and never executed.
```

**Data usage**: tick nothing. Then certify:
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**
```
https://github.com/AES256Afro/xIT/blob/main/PRIVACY.md
```

---

## Graphics

| Field | File | Size |
|---|---|---|
| Store icon | `src/icons/icon-128.png` | 128×128 |
| Screenshot 1 | `store/assets/screenshot-1-copy-any-tweet.png` | 1280×800 |
| Screenshot 2 | `store/assets/screenshot-2-popup.png` | 1280×800 |
| Screenshot 3 | `store/assets/screenshot-3-both-routes.png` | 1280×800 |
| Screenshot 4 | `store/assets/screenshot-4-browse-redirect.png` | 1280×800 |
| Screenshot 5 | `store/assets/screenshot-5-custom-instance.png` | 1280×800 |
| Small promo tile | `store/assets/promo-tile-small-440x280.png` | 440×280 |
| Marquee promo tile | `store/assets/promo-tile-marquee-1400x560.png` | 1400×560 |

Screenshots are required (at least one). Promo tiles are optional, but the small
tile is what appears if the item is ever featured.

---

## Other fields

- **Homepage URL:** `https://github.com/AES256Afro/xIT`
- **Support URL:** `https://github.com/AES256Afro/xIT/issues`
- **Distribution:** Public
- **Visibility:** Public (or Unlisted if you only want to share the link)

---

## If the dashboard refuses to submit

**Why can't I submit?** lists the blockers. The two that catch people out:

- *"A justification for remote code use is required."* Answering **No** is not
  enough on its own. The justification textarea above is still mandatory.
- *"At least one screenshot or video is required."* Screenshots are uploaded on
  the **Store listing** tab, not Privacy. All five are in `store/assets/`.

Press **Save draft** after fixing them, then try **Submit for review** again.

## Expect review friction

Be ready for these; none are fatal, but they slow a first submission:

1. **Broad optional host permissions.** `*://*/*` in `optional_host_permissions`
   draws attention even though nothing is granted at install. The justification
   above is the honest explanation, since custom self-hosted instances cannot be
   enumerated ahead of time. If a reviewer pushes back, the fallback is to drop
   `*://*/*`, list only the bundled redirector hosts, and accept that custom
   templates can then only be used for copying, not for page redirecting.
2. **Affecting a major site's behaviour.** Rewriting X's own "Copy link" is
   legitimate and disclosed, but say so plainly if asked: it is a user-invoked
   convenience, applied only to a lone tweet URL, and switchable off.
3. **First reviews are slow.** Days, occasionally weeks. Updates are faster.
