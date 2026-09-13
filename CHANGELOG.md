# Changelog

## 1.0.1

- Fix an endless message exchange between content scripts that could make X tabs unresponsive while xIT was enabled, even with browse redirect off.
- Keep native copy-link conversion and settings updates working without restarting the message exchange.
- Include the fix in both Chrome and Firefox builds, with regression coverage for either content-script startup order.
