# Submitting xIT

Everything needed for both stores lives in this folder. The listing copy is
paste-ready; the images are generated from the real UI.

```bash
npm run prepare-dist    # icons + dist/chrome + dist/firefox + zips
npm run store-assets    # screenshots and promo tiles into store/assets/
```

| What | Where |
|---|---|
| Chrome package | `dist/xit-chrome-1.0.7.zip` |
| Firefox package | `dist/xit-firefox-1.0.7.zip` |
| Chrome listing copy | [`chrome-web-store.md`](chrome-web-store.md) |
| Firefox listing copy | [`firefox-amo.md`](firefox-amo.md) |
| Screenshots + tiles | `assets/` |
| Privacy policy | [`../PRIVACY.md`](../PRIVACY.md) |
| Licence | [`../LICENSE`](../LICENSE) |

---

## Do these first

**1. Push the repo.** Done. Both listings reference GitHub URLs, and Chrome
*requires* a publicly reachable privacy policy URL. This one resolves:
`https://github.com/AES256Afro/xIT/blob/main/PRIVACY.md`

**2. Confirm the Firefox add-on id.** It is `xit@aes256afro.github.io`, set in
`tools/build.mjs`. It becomes the add-on's permanent identity on AMO the moment
you submit. You cannot change it afterwards without breaking update
continuity. Change it now if you want something else, and rebuild.

---

## Chrome Web Store

**Published on 13 September 2026.**
Item ID `clilllbfkoeamfonhoeaaepglgceanlc`, public, all regions.
Listing: <https://chromewebstore.google.com/detail/xit/clilllbfkoeamfonhoeaaepglgceanlc>

The steps below are kept for future submissions and version updates.

1. Pay the one-time **US$5** developer registration at
   <https://chrome.google.com/webstore/devconsole>. Nothing can be submitted
   before this clears.
2. **New item** → upload `dist/xit-chrome-1.0.7.zip`.
3. Fill **Store listing** from [`chrome-web-store.md`](chrome-web-store.md):
   name, short description, detailed description, category, graphics.
4. Fill **Privacy practices**: single purpose, a justification for every
   permission, and the data-use certifications. All the text is in the same
   file. This is the section that gets submissions rejected, so do not rush it.
5. **Submit for review.** First reviews take days, sometimes weeks. Updates are
   usually much faster.

## Firefox (AMO)

1. Sign in at <https://addons.mozilla.org/developers/>. No fee.
2. **Submit a New Add-on** → choose **listed** (public directory) or
   **unlisted** (signed file only, no review queue, no public page).
3. Upload `dist/xit-firefox-1.0.7.zip`.
4. Fill the fields from [`firefox-amo.md`](firefox-amo.md), including the
   **notes for the reviewer**, which pre-empt the two questions this add-on
   will otherwise get asked about (the main-world clipboard patch, and the
   declarativeNetRequest permission kept only for cleanup).
5. Submit. Unlisted is usually signed within minutes; listed goes into a queue.

Either route gives you a **signed** build. That matters: the
`about:debugging` install used during development disappears on restart, and a
signed `.xpi` does not.

---

## Releasing a new version

1. Bump `version` in `package.json`. Both manifests read it.
2. `npm test && npm run prepare-dist`
3. Run `npm run test:browser`, `npm run test:qol`, and `npm run test:firefox`; see the development
   prerequisites in the [README](../README.md#development).
4. Re-run `npm run store-assets` if the UI changed and inspect the images.
5. Upload the new zips. Chrome reuses the listing; AMO wants version notes.

Neither store lets you reuse a version number, even for a rejected submission.

---

## Honest expectations

- **Public front-ends can disappear.** The bundled list is current as of
  release, not a permanent promise. The Nitter-based ones were withdrawn in
  1.0.7 after a cease and desist; expect to revisit the list again.
- **`declarativeNetRequest` is declared but unused.** It exists only to remove
  rules earlier versions installed. Drop it in the release after users have had
  time to update, which also removes a permission warning.
- **The in-tweet button depends on X's DOM.** X ships breaking layout changes
  regularly. When it happens, `isTweetActionBar` in `src/content/inject.js` is
  the thing to fix. The native "Copy link" patch does not depend on the DOM and
  keeps working meanwhile.
- **Chrome may push back on `*://*/*`** in `optional_host_permissions`, even
  though nothing is granted at install time. The justification is written out
  in the listing file; the fallback, if a reviewer insists, is to enumerate only
  the bundled hosts and accept that custom instances then work for copying but
  not for page redirecting.
