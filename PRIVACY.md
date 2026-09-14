# xIT Privacy Policy

**Last updated: 14 September 2026**

xIT has no analytics or telemetry and does not sell personal information.

## What xIT collects

Nothing. There is no analytics, no telemetry, no crash reporting, no account,
no licence check and no "anonymous usage statistics".

## What xIT stores, and where

Your settings: the redirector you chose as default, which ones you enabled,
any custom templates you added, and your copy and redirect preferences. Local
operational status records whether redirect rules installed successfully and
whether context-menu creation failed. It contains configuration and diagnostic
messages, not a history of visited pages or copied links.

These live in your browser's own extension storage (`chrome.storage.local`) on
your device. They are never uploaded by xIT and are not written to the
browser's extension sync storage.

Version 1.0.5 removes the old failed-copy recovery record on startup and reset.
Failed copies no longer retain a URL or timestamp.

Uninstalling the extension deletes them.

## Network requests xIT makes

xIT makes no network requests of its own, with one exception: the **Check which
are reachable** button on the Settings page. Pressing it sends one plain request
to the front page of each redirector you have enabled, purely to see whether the
host answers. Requests omit cookies, credentials, and referrers and do not include
tweet URLs or browsing history. Like any network request, they expose your IP
address and normal browser connection information to the destination. Redirect
responses are not followed. The check only runs when you press the button, asks
for access to the enabled hosts, and runs at most three checks at a time.

xIT has no author-operated service or telemetry endpoint. Apart from the
user-requested checks above, it makes no service requests. There is no remote
code: everything that runs is in the package you installed.

## What happens when you copy or redirect a link

Rewriting a link is pure text manipulation performed locally in your browser.
xIT reads the tweet URL, swaps the hostname and path according to your chosen
template, and puts the result on your clipboard. Nothing is sent anywhere.

If you enable **Redirect page loads**, your browser, not xIT, performs the
redirect using its built-in `declarativeNetRequest` rules. The extension
supplies the rules when settings change and does not record browsing history.

When you then *visit* a redirected site (fxtwitter.com, xcancel.com, a Nitter
instance, or your own), you are visiting a third party that xIT has no
relationship with or control over. Their handling of your data is governed by
their own policies. Many public front-ends are run anonymously by volunteers.
Choose the ones you trust.

## Permissions

Each permission xIT requests, and what it is used for, is listed in the
[README](README.md#permissions-and-why). None of them are used to gather
information about you.

## Children

xIT is a developer utility with no accounts and no data collection. It is not
directed at children.

## Changes

Any change to this policy will be committed to this repository, and the date
above updated. The git history is the full record.

## Contact

Open an issue at <https://github.com/AES256Afro/xIT/issues>.
