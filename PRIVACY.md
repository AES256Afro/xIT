# Privacy Policy — Xit

**Last updated: 11 September 2026**

Xit does not collect, transmit, store or sell any personal information.

## What Xit collects

Nothing. There is no analytics, no telemetry, no crash reporting, no account,
no licence check and no "anonymous usage statistics".

## What Xit stores, and where

Your settings — the redirector you chose as default, which ones you enabled,
any custom templates you added, and your copy and redirect preferences.

These live in your browser's own extension storage (`chrome.storage.local`) on
your device. They are never uploaded. If your browser has extension sync turned
on, your browser may sync them between your own devices under its own privacy
policy; Xit neither requests nor receives that data.

Uninstalling the extension deletes them.

## Network requests Xit makes

Xit makes no network requests of its own, with one exception: the **Check which
are reachable** button on the Settings page. Pressing it sends one plain request
to the front page of each redirector you have enabled, purely to see whether the
host answers. No information about you, your browsing or your tweets is included
in those requests. It only runs when you press the button.

Xit does not contact the author, any server belonging to the author, or any
third-party service. There is no remote code: everything that runs is in the
package you installed.

## What happens when you copy or redirect a link

Rewriting a link is pure text manipulation performed locally in your browser.
Xit reads the tweet URL, swaps the hostname and path according to your chosen
template, and puts the result on your clipboard. Nothing is sent anywhere.

If you enable **Redirect page loads**, your browser — not Xit — performs the
redirect using its built-in `declarativeNetRequest` rules. The extension
supplies the rules once; it does not observe, log or receive your browsing.

When you then *visit* a redirected site (fxtwitter.com, xcancel.com, a Nitter
instance, or your own), you are visiting a third party that Xit has no
relationship with or control over. Their handling of your data is governed by
their own policies. Many public front-ends are run anonymously by volunteers.
Choose the ones you trust.

## Permissions

Each permission Xit requests, and what it is used for, is listed in the
[README](README.md#permissions-and-why). None of them are used to gather
information about you.

## Children

Xit is a developer utility with no accounts and no data collection. It is not
directed at children.

## Changes

Any change to this policy will be committed to this repository, and the date
above updated. The git history is the full record.

## Contact

Open an issue at <https://github.com/AES256Afro/xIT/issues>.
