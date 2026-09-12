# Xit

A Chrome and Firefox extension that copies X/Twitter links through a redirector
of your choice — `fxtwitter` by default, or any of the bundled privacy
frontends, thread unrollers, or your own self-hosted instance.

Both copy routes give you the same rewritten link:

- **The button on every tweet.** Click it to copy with your default; click the
  chevron (or right-click, or long-press) to pick a different one for that copy.
- **X's own "Copy link".** The native share menu is patched so it returns the
  redirected URL too, with no change to how the menu looks or behaves.

Plus a right-click menu on any tweet link anywhere on the web, an optional
browse redirect, and a keyboard shortcut.

## Install

Nothing is published to either store, so both sides load unpacked.

```bash
npm run prepare-dist
```

That writes `dist/chrome/` and `dist/firefox/` (and a `.zip` of each).

**Chrome / Edge / Brave** — go to `chrome://extensions`, turn on *Developer
mode*, click *Load unpacked*, pick `dist/chrome`.

**Firefox** — go to `about:debugging#/runtime/this-firefox`, click *Load
Temporary Add-on*, pick `dist/firefox/manifest.json`. Temporary add-ons are
dropped on restart; for a permanent install you need a signed build via
[addons.mozilla.org](https://addons.mozilla.org/developers/).

On Firefox, MV3 host permissions are opt-in: open the extension's popup and use
**Grant access to x.com** the first time, then reload your X tab.

## What's included

| Group | Redirectors | For |
|---|---|---|
| Embed fixers | fxtwitter, fixupx, twittpr, vxtwitter, fixvx, d.fxtwitter | Tweets that unfurl properly in Discord, Slack, Signal |
| Privacy frontends | xcancel, twiiit, nitter.net, nitter.poast.org, nitter.privacydev.net | Reading without tracking or the login wall |
| Thread tools | Thread Reader App, Unroll Now | Unrolling a long thread |
| Custom | yours | Self-hosted instances, anything not listed |

**Public instances come and go.** Nitter instances in particular go dark without
warning. Settings has a *Check which are reachable* button, but it only proves
the host answered — not that it still renders tweets. If your default stops
working, switch it, or add your own instance under **Custom redirector**.

## Custom templates

A template is a URL with tokens filled in from the original link:

| Token | From `https://x.com/jack/status/20?s=20` |
|---|---|
| `{path}` | `jack/status/20` |
| `{query}` | `` (empty — `s=20` is stripped as tracking) |
| `{user}` | `jack` |
| `{id}` | `20` |
| `{hash}` | `` |
| `{host}` | `x.com` |

A plain mirror is `https://your.host/{path}{query}`. Something that only handles
single tweets is more like `https://your.host/tweet/{id}` — templates built from
`{id}` are automatically refused for profile links rather than producing a
broken URL.

## Browse redirect

Off by default. When on, loading `x.com` sends you to your chosen frontend
before the page is fetched (via `declarativeNetRequest`, so x.com never loads
and never sees the request).

Scope is per page type — tweets, profiles, everything else — and your own home
timeline, messages, notifications, bookmarks and settings are **never**
redirected, since a frontend cannot show them and you would just be locked out.
Your logged-in X session is untouched; you simply stop landing on it.

To reach a page on x.com anyway, append `?xit_bypass=1`. The extension tidies the
parameter out of the address bar once the page loads.

## Keyboard shortcut

`Alt+Shift+C` copies the tweet under the pointer (or the one in view) with the
default redirector. Rebind it at `chrome://extensions/shortcuts`, or in Firefox
at `about:addons` → gear → *Manage Extension Shortcuts*. Browsers do not let a
page link to those addresses, so paste them in yourself.

## Permissions, and why

| Permission | Why |
|---|---|
| `storage` | Your settings. Local only. |
| `contextMenus` | The right-click menu. |
| `activeTab` + `scripting` | Writing to the clipboard when you use the right-click menu on a page where the content script is not running. Granted per click, not standing. |
| `declarativeNetRequest` | The browse redirect. Rules are evaluated by the browser; the extension never sees your browsing. |
| `clipboardWrite` | Copying. |
| Host access to x.com / twitter.com | The button, and reading the tweet permalink. |
| Optional host access | Only requested for a redirect target when you actually turn on the browse redirect, because a cross-origin redirect needs permission for the destination. |

No analytics, no network requests of its own, no remote code. The only outbound
request it ever makes is the reachability check, and only when you press that
button.

## Development

```bash
npm test                 # URL parsing, templates, generated redirect rules
npm run icons            # regenerate src/icons/*.png
npm run build            # dist/chrome + dist/firefox + zips
npm run prepare-dist     # icons + build, in one go
npm run store-assets     # store screenshots and promo tiles (needs Chrome)
```

One source tree in `src/` builds both browsers; `tools/build.mjs` generates the
two manifests, which differ only in the background-script style and the
Firefox add-on id.

Store screenshots are rendered by headless Chrome from the *real* popup, options
page and content script, with only the extension APIs stubbed — so they cannot
drift from the shipped UI. See [`store/SUBMISSION.md`](store/SUBMISSION.md).

```
src/
  lib/redirectors.js   presets, URL parsing, templates, redirect-rule compiler
  lib/storage.js       settings, defaults, normalisation
  background.js        context menus, redirect rules, shortcut
  content/inject.js    the button, dropdown, toast          (isolated world)
  content/main-world.js  wraps navigator.clipboard          (main world)
  popup/  options/     UI
```

`content/main-world.js` is the only part that runs in the page's own JS context,
and only so it can wrap `navigator.clipboard`. It holds no extension privileges,
never touches anything but a lone tweet URL (prose and plain text are passed
through untouched), and talks to the rest over `postMessage`.

### Known limits

- The in-tweet button depends on X's DOM. X ships layout changes regularly; if
  the button disappears, the selector in `isTweetActionBar` is the place to look.
  The native "Copy link" hijack does not depend on the DOM and will keep working.
- `world: "MAIN"` content scripts need Chrome 111+ / Firefox 128+. On older
  builds the extension falls back to intercepting the "Copy link" menu item
  directly, which is more fragile but functional.
- Firefox temporary add-ons disappear on restart.

## Publishing

Listing copy, permission justifications and generated artwork for both stores
live in [`store/`](store/):

- [`store/SUBMISSION.md`](store/SUBMISSION.md) — what to do, in order
- [`store/chrome-web-store.md`](store/chrome-web-store.md) — Chrome fields
- [`store/firefox-amo.md`](store/firefox-amo.md) — AMO fields

## Privacy

No analytics, no telemetry, no accounts, no remote code. Xit makes no network
requests of its own except the optional reachability check you trigger by hand.
Full text: [PRIVACY.md](PRIVACY.md).

## Licence

[MIT](LICENSE).
