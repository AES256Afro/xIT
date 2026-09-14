# Changelog

## 1.0.4

- Fix the redirector menu closing as soon as you scrolled it, which made the thread tools and the footer buttons unreachable.
- Navigate the menu with the keyboard without the list closing partway down.
- Rebuild the context menus once per settings change instead of twice, with storage events as the single trigger.

## 1.0.3

- Serialize all startup and settings refreshes to prevent duplicate context-menu IDs during installation and updates.
- Wait for menu removal and creation to finish, report asynchronous errors, and recover on later refreshes.
- Cover overlapping events and failure recovery with Chrome and Firefox API regression tests.

## 1.0.2

- Add the Firefox data-collection declaration required for new AMO submissions.
- Build the in-page menu and SVG icons with DOM APIs instead of HTML strings, resolving Mozilla's three HTML assignment warnings.
- Retain the 1.0.1 fix for unresponsive X tabs in both browser packages.

## 1.0.1

- Fix an endless message exchange between content scripts that could make X tabs unresponsive while xIT was enabled, even with browse redirect off.
- Keep native copy-link conversion and settings updates working without restarting the message exchange.
- Include the fix in both Chrome and Firefox builds, with regression coverage for either content-script startup order.
