/*
 * xIT - Settings: export, import and reset.
 *
 * One of the classic scripts options.html loads in order. They share the
 * page's top-level names, as the sections of one file would: page.js holds
 * the state and helpers the others use, and options.js starts the page.
 */
'use strict';

/* ---- import / export ---- */

function exportSettings() {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'xit-settings.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  saved(XITI18N.t('savedExported'));
}

/**
 * What a reset leaves enabled, and which of them becomes the default.
 *
 * Both facts are read from DEFAULTS, which is what a reset actually applies.
 * Written into the sentence instead, they would be right until the bundled
 * set changed and then quietly wrong.
 */
function resetDefaults() {
  const id = XITStore.DEFAULTS.defaultRedirector;
  const entry = XIT.PRESETS.find((p) => p.id === id) || XIT.findCatalogue(id);
  return XITI18N.t('resetDefaults',
    [String(XITStore.DEFAULTS.enabledIds.length), (entry && entry.name) || id]);
}

/**
 * An import failure, shown in the page rather than in a blocking alert(). It
 * stays until the next attempt, because the user may need to go and look at
 * the file, and role="alert" means a screen reader announces it without
 * moving focus.
 */
function backupError(text) {
  const node = $('backup-error');
  node.textContent = text || '';
  node.hidden = !text;
}

/**
 * Import offers a choice: replace everything, or add only their redirectors
 * and keep your own default, pins and switches. The file is read first and
 * the choice offered second, because what the file actually contains is what
 * makes the choice meaningful.
 */
let pendingImport = null;

async function importSettings(file) {
  backupError('');
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch (e) {
    $('saved').textContent = '';
    backupError(XITI18N.t('importUnreadable', [String((e && e.message) || e)]));
    return;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    backupError(XITI18N.t('importNotObject'));
    return;
  }
  const theirs = Array.isArray(raw.custom) ? raw.custom : [];
  const usable = theirs.filter((c) => c && XIT.validateTemplate(c.template).ok);
  // Every redirector already available, bundled ones included, and not
  // just the user's own. The merge itself skips a template it already has;
  // counting only `custom` here would offer an Add that adds nothing and
  // then report "Nothing to add."
  const mine = new Set(XITStore.allRedirectors(settings).map((r) => r.template));
  const fresh = usable.filter((c) => !mine.has(c.template));
  pendingImport = raw;
  $('import-summary').textContent = fresh.length
    ? XITI18N.t(fresh.length === 1 ? 'importSummaryOne' : 'importSummaryMany', [String(fresh.length), String(usable.length)])
    : usable.length
      ? XITI18N.t('importNothingNew')
      : XITI18N.t('importNoneAtAll');
  $('import-merge').disabled = !fresh.length;
  $('import-replace').disabled = false;
  $('confirm-import').showModal();
}

async function applyImport(mode) {
  const raw = pendingImport;
  pendingImport = null;
  $('confirm-import').close();
  if (!raw) return;
  const before = new Set(settings.custom.map((c) => c.id));
  try {
    settings = await (mode === 'merge' ? XITStore.merge(raw) : XITStore.replace(raw));
    render();
    if (mode !== 'merge') { saved(XITI18N.t('savedImported')); return; }
    const gained = settings.custom.filter((c) => !before.has(c.id)).length;
    // The browser's message format has no plural rules, so the choice of
    // message is made here and a translator gets one message per form.
    saved(gained
      ? XITI18N.t(gained === 1 ? 'importAddedOne' : 'importAddedMany', [String(gained)])
      : XITI18N.t('importNothingToAdd'));
  } catch (e) {
    $('saved').textContent = '';
    backupError(XITI18N.t('importUnreadable', [String((e && e.message) || e)]));
  }
}
