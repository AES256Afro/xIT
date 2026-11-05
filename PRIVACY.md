# xIT Privacy Policy

**Last updated: 4 November 2026**

xIT has no analytics or telemetry and does not sell personal information.

## What xIT collects

Nothing. There is no analytics, no telemetry, no crash reporting, no account,
no licence check and no "anonymous usage statistics".

## What xIT stores, and where

Your settings: the redirector you chose as default, which ones you enabled,
any custom templates you added, the order of pinned entries, and your copy
preferences. Local operational status records whether context-menu creation
failed. It contains configuration and diagnostic messages, not a history of
visited pages or copied links.

These live in your browser's own extension storage (`chrome.storage.local`) on
your device. They are never uploaded by xIT and are not written to the
browser's extension sync storage.

Undo removal keeps the most recently removed custom entry and its selections
in the browser's in-memory `storage.session` area. It is cleared by undo, the
next removal, import, reset, or browser restart.

Reachability results, if you ever press Check, are kept under their own key:
each checked host, what it answered and when. No URLs and nothing about what
you copied.

Version 1.0.5 removes the old failed-copy recovery record on startup and reset.
Failed copies no longer retain a URL or timestamp. Version 1.0.7 removes the
page-redirect settings and status, including the name of any chosen
destination, from stored data on startup.

Uninstalling the extension deletes them.

## Network requests xIT makes

xIT has no author-operated service and no telemetry endpoint, and there is no
remote code: everything that runs is in the package you installed.

It makes exactly one kind of network request, and only when you ask for it. If
you press **Check** or **Check which are reachable** in Settings, xIT sends one
`HEAD` request to the front page of each redirector host being checked, to see
whether it still answers. That is it: nothing on a timer, nothing on startup,
nothing when settings change, and nothing when you copy a link.

The request carries no information about you, the link you were looking at, or
what you copied. It goes to the redirector's own origin, for example
`https://fxtwitter.com/`, and nowhere else.

Reading the answer requires permission to access that host, so xIT asks for it
at the moment you press the button, for those hosts only, and the browser shows
you the prompt. Access is not granted on install. If you decline, nothing is
checked. You can withdraw it afterwards in your browser's extension settings.

Only the redirectors xIT ships can be checked. A custom template of yours
cannot, because the permission would have to be declared in advance, and xIT
will not ask for access to every site in order to offer this.

The result, which host was checked, what it answered and when, is stored
locally under its own key alongside your settings. It is not exported with
your settings and never leaves your device.

Versions 1.0.7 and 1.0.8 made no network requests at all. Version 1.0.6 had
a check that could not read status codes, so a host returning a server error
was reported as healthy.

## What happens when you copy a link

Rewriting a link is pure text manipulation performed locally in your browser.
xIT reads the tweet URL, swaps the hostname and path according to your chosen
template, and puts the result on your clipboard. Nothing is sent anywhere.

xIT no longer redirects page loads. Version 1.0.7 removed that feature, and
removes on startup any redirect rules earlier versions installed.

When you then *visit* a link xIT produced (fxtwitter.com, vxtwitter.com, a
thread reader, or your own instance), you are visiting a third party that xIT
has no relationship with or control over. Their handling of your data is
governed by their own policies. Choose the ones you trust.

## Diagnostics you choose to copy

**Copy diagnostics** creates a local report with extension and browser versions,
X access status, context-menu status, copy preferences, and whether
the content script responds in an open X tab. It excludes tab URLs, custom
templates, clipboard contents, raw error messages, and browsing history.
The report is placed on your clipboard only when you press the button. Settings
also displays it. xIT does not send the report anywhere; you decide whether to
share it.

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
