# xIT Privacy Policy

**Last updated: 14 September 2026**

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

Version 1.0.5 removes the old failed-copy recovery record on startup and reset.
Failed copies no longer retain a URL or timestamp. Version 1.0.7 removes the
page-redirect settings and status, including the name of any chosen
destination, from stored data on startup.

Uninstalling the extension deletes them.

## Network requests xIT makes

xIT makes no network requests of any kind. It has no author-operated service
and no telemetry endpoint, and since 1.0.7 it no longer has the reachability
check that earlier versions could send at your request. There is no remote
code: everything that runs is in the package you installed.

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
