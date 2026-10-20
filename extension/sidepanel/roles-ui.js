// The Roles tab (collected roles, this page, filters, fit scores) and the Tracker tab (applications, deadlines).
// Role data comes from web pages, so everything is rendered with textContent — never innerHTML.

import { getAllRoles, updateRole, deleteRole, saveRecords, loadFilters, saveFilters, reevaluateAll } from '../lib/store.js';
import { scoreRole, scoreMany } from '../lib/fit.js';
import { loadProfile, profileForAI } from '../lib/profile.js';
import { getSettings, saveSettings } from '../lib/settings.js';
import { STATUSES, OPEN_STATUSES, APPLIED_STATUSES, daysUntil, toCSV } from '../lib/roles.js';
import { recordPageRoles } from '../lib/page-roles.js';

const $ = (id) => document.getElementById(id);
const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const statusLabel = Object.fromEntries(STATUSES);

const state = { roles: [], pageRoles: [], view: null, trackerView: 'active', query: '', scoring: false, stop: false };

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}
const chip = (text, cls = '', title = '') => el('span', { className: `chip ${cls}`.trim(), textContent: text, title });
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');

// ---------- formatting ----------

function stipendLabel(r) {
  const s = r.stipend;
  if (!s) return '';
  if (s.unpaid) return 'Unpaid';
  const k = (n) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n));
  if (s.perMonthINR) return s.perMonthINR.min === s.perMonthINR.max ? `₹${k(s.perMonthINR.max)}/mo` : `₹${k(s.perMonthINR.min)}–${k(s.perMonthINR.max)}/mo`;
  return s.text && s.text.length < 28 ? s.text : '';
}

function deadlineChip(r) {
  if (!r.deadline) return null;
  const d = daysUntil(r.deadline);
  if (d < 0) return chip('Deadline passed', 'danger');
  if (d > 45) return null; // far-off dates are just noise on a card (the date is still kept and editable)
  const text = d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : `Due in ${d}d`;
  return chip(text, d <= 3 ? 'urgent' : '', r.deadline);
}

const VERDICT = { match: ['Match', 'match'], maybe: ['Maybe', 'maybe'], skip: ['Skip', ''] };

// ---------- role card ----------

async function act(id, patch) {
  await updateRole(id, patch);
}

function roleCard(r, { tracker = false } = {}) {
  const v = r.eval?.verdict || 'maybe';
  const li = el('li', { className: `role v-${v}` });

  const sub = [r.company, r.location].filter(Boolean).join(' · ');
  li.append(
    el('a', { className: 'title', href: safeUrl(r.url), target: '_blank', rel: 'noopener noreferrer', textContent: r.title }),
    sub || r.remote ? el('div', { className: 'sub' }, sub, r.remote && !/remote|home/i.test(sub) ? ' · Remote' : '') : null
  );

  const chips = el('div', { className: 'chips' });
  if (r.kind === 'opportunity') chips.append(chip('Hackathon / opportunity', 'maybe'));
  if (!tracker) chips.append(chip(VERDICT[v][0], VERDICT[v][1]));
  if (r.fit) chips.append(chip(`Fit ${r.fit.score}`, 'fit', r.fit.reason));
  const pay = stipendLabel(r);
  if (pay) chips.append(chip(pay, pay === 'Unpaid' ? 'warn' : ''));
  if (r.durationMonths) chips.append(chip(`${r.durationMonths} mo`));
  chips.append(...[deadlineChip(r)].filter(Boolean));
  if (r.source) chips.append(chip(r.source.replace(/\.(com|in|io|co)$/, '')));
  for (const f of r.eval?.flags || []) chips.append(chip(f.text, f.severity === 'danger' ? 'danger' : 'warn'));
  if (r.dupOf) chips.append(chip(`Already ${statusLabel[r.dupOf.status]?.toLowerCase() || 'applied'} elsewhere`, 'warn'));
  li.append(chips);

  // why / fit details
  const why = (r.eval?.reasons || []).map((x) => el('li', { className: x.kind, textContent: x.text }));
  const fitBits = r.fit
    ? [
        el('li', { className: r.fit.eligible === 'no' ? 'fail' : r.fit.eligible === 'check' ? 'warn' : 'ok', textContent: `Eligibility: ${r.fit.eligible}${r.fit.confidence === 'low' ? ' (low confidence)' : ''}` }),
        ...r.fit.strengths.map((s) => el('li', { className: 'ok', textContent: s })),
        ...r.fit.gaps.map((s) => el('li', { className: 'warn', textContent: s })),
        r.fit.reason ? el('li', { textContent: r.fit.reason }) : null,
      ]
    : [];
  if (why.length || fitBits.length) li.append(el('details', {}, el('summary', { textContent: r.fit ? 'Why this fit score' : 'Why' }), el('ul', {}, ...fitBits, ...why)));

  if (tracker) li.append(trackFields(r));
  li.append(roleActions(r, { tracker }));
  return li;
}

function roleActions(r, { tracker }) {
  const bar = el('div', { className: 'role-actions' });
  const btn = (text, onClick, title = '') => {
    const b = el('button', { type: 'button', className: 'btn', textContent: text, title });
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await onClick(b);
      } finally {
        b.disabled = false;
      }
    });
    return b;
  };

  if (!tracker) {
    bar.append(
      btn(r.status === 'saved' ? '★ Shortlisted' : '☆ Shortlist', () => act(r.id, { status: r.status === 'saved' ? 'new' : 'saved' }), 'Shortlisted roles get deadline reminders'),
      btn('Applied', () => markApplied(r), 'Move to the tracker and set a follow-up reminder')
    );
  }
  bar.append(
    btn(r.fit ? 'Re-rate fit' : 'Rate fit', async (b) => {
      b.textContent = 'Rating…';
      try {
        const { profile } = await loadProfile();
        await scoreRole(r.id, profileForAI(profile));
      } catch (err) {
        notice(`${err.message}${err.hint ? ` — ${err.hint}` : ''}`, 'error');
      }
    }, 'AI compares this posting with your profile')
  );
  if (!tracker) bar.append(btn('Ignore', () => act(r.id, { status: 'ignored' })));
  if (r.status === 'ignored') bar.append(btn('Restore', () => act(r.id, { status: 'new' })));
  bar.append(
    btn('Delete', async () => {
      await deleteRole(r.id);
    })
  );
  return bar;
}

async function markApplied(r) {
  await act(r.id, { status: 'applied', appliedAt: new Date().toISOString(), followUpAt: r.followUpAt || iso(new Date(Date.now() + 7 * DAY)) });
}

/** Tracker: status, dates, notes. */
function trackFields(r) {
  const box = el('div', { className: 'track' });
  const select = el('select', { ariaLabel: 'Status' }, ...STATUSES.map(([v, label]) => el('option', { value: v, textContent: label, selected: v === r.status })));
  select.addEventListener('change', async () => {
    const patch = { status: select.value };
    if (APPLIED_STATUSES.has(select.value) && !r.appliedAt) {
      patch.appliedAt = new Date().toISOString();
      if (select.value === 'applied' && !r.followUpAt) patch.followUpAt = iso(new Date(Date.now() + 7 * DAY));
    }
    await act(r.id, patch);
  });
  const date = (label, key) => {
    const input = el('input', { type: 'date', value: r[key] ? String(r[key]).slice(0, 10) : '' });
    input.addEventListener('change', () => act(r.id, { [key]: input.value || null, notified: { ...(r.notified || {}), ...(key === 'followUpAt' ? { followUp: undefined } : { deadline: undefined }) } }));
    return el('label', {}, label, input);
  };
  const notes = el('textarea', { rows: 2, value: r.notes || '', placeholder: 'Notes (recruiter, referral, round details…)' });
  let timer;
  notes.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => act(r.id, { notes: notes.value }), 600);
  });
  box.append(el('label', {}, 'Status', select), date('Deadline', 'deadline'), date('Follow up on', 'followUpAt'), r.appliedAt ? el('label', {}, 'Applied', el('div', { textContent: r.appliedAt.slice(0, 10) })) : null, el('label', { className: 'full' }, notes));
  return box;
}

// ---------- notices ----------

let noticeTimer;
function notice(text, kind = 'ok') {
  const box = $('roles-notice');
  box.hidden = !text;
  box.className = `notice ${kind}`;
  box.textContent = text;
  clearTimeout(noticeTimer);
  if (text && kind === 'ok') noticeTimer = setTimeout(() => (box.hidden = true), 6000);
}

// ---------- Roles tab ----------

const ORDER = { match: 0, maybe: 1, skip: 2 };
function sorted(list) {
  return [...list].sort(
    (a, b) =>
      (b.fit?.score ?? -1) - (a.fit?.score ?? -1) ||
      (ORDER[a.eval?.verdict] ?? 1) - (ORDER[b.eval?.verdict] ?? 1) ||
      String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')) ||
      String(b.updatedAt).localeCompare(String(a.updatedAt))
  );
}

const INBOX = (r) => r.status === 'new' || r.status === 'saved';
const VIEWS = [
  ['matches', 'Matches', (r) => INBOX(r) && r.kind === 'job' && r.eval?.verdict === 'match'],
  ['maybe', 'Maybe', (r) => INBOX(r) && r.kind === 'job' && r.eval?.verdict === 'maybe'],
  ['shortlist', '★', (r) => r.status === 'saved'],
  ['opps', 'Hackathons', (r) => INBOX(r) && r.kind === 'opportunity'],
  ['skipped', 'Skipped', (r) => INBOX(r) && r.kind === 'job' && r.eval?.verdict === 'skip'],
  ['ignored', 'Ignored', (r) => r.status === 'ignored'],
  ['all', 'All', () => true],
];

function viewChips(container, views, current, counts, onPick) {
  container.replaceChildren(
    ...views.map(([key, label]) => {
      const b = el('button', { type: 'button', className: 'chip-btn', role: 'tab', ariaSelected: String(key === current) }, label, el('span', { className: 'n', textContent: counts[key] ?? 0 }));
      b.addEventListener('click', () => onPick(key));
      return b;
    })
  );
}

function matchesQuery(r) {
  const q = state.query.trim().toLowerCase();
  return !q || `${r.title} ${r.company} ${r.location}`.toLowerCase().includes(q);
}

function renderRoles() {
  const counts = Object.fromEntries(VIEWS.map(([k, , f]) => [k, state.roles.filter(f).length]));
  if (!state.view || !counts.hasOwnProperty(state.view)) state.view = counts.matches ? 'matches' : 'all';
  viewChips($('role-views'), VIEWS, state.view, counts, (k) => {
    state.view = k;
    renderRoles();
  });

  const filter = VIEWS.find(([k]) => k === state.view)[2];
  const list = sorted(state.roles.filter((r) => filter(r) && matchesQuery(r)));
  const unrated = state.roles.filter((r) => INBOX(r) && r.kind === 'job' && r.eval?.verdict !== 'skip' && !r.fit);
  $('score-all').textContent = `Rate fit for matches (${Math.min(unrated.length, 8)})`;
  $('score-all').disabled = state.scoring || !unrated.length;

  if (!list.length) {
    $('roles-list').replaceChildren(
      el('li', { className: 'empty-note muted', textContent: state.roles.length ? 'Nothing here. Try another view or loosen your filters.' : 'No roles yet. Open a job, internship or hackathon page (LinkedIn, Internshala, Naukri, Indeed, Unstop, company career pages) and Twigg collects it.' })
    );
    return;
  }
  const shown = list.slice(0, 60);
  $('roles-list').replaceChildren(...shown.map((r) => roleCard(r)), ...(list.length > shown.length ? [el('li', { className: 'empty-note muted', textContent: `Showing ${shown.length} of ${list.length} — use search to narrow down.` })] : []));
}

// ---------- "this page" card ----------

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function renderPageCard() {
  const card = $('page-card');
  const id = await activeTabId();
  const page = id != null ? (await chrome.storage.session.get(`page:${id}`))[`page:${id}`] : null;
  state.pageRoles = page?.roles || [];
  if (!state.pageRoles.length) {
    card.hidden = true;
    return;
  }
  const stored = new Map(state.roles.map((r) => [r.id, r]));
  const live = state.pageRoles.map((p) => ({ ...p, ...(stored.get(p.id) || {}) }));
  const single = live.length === 1;
  const matches = live.filter((r) => r.eval?.verdict === 'match');
  const unsaved = live.filter((r) => !stored.has(r.id));

  card.replaceChildren(el('h4', { textContent: 'On this page' }));
  const applied = live.find((r) => APPLIED_STATUSES.has(r.status));
  const dup = live.find((r) => r.dupOf);
  if (applied) card.append(el('div', { className: 'warn-line', textContent: `You already ${statusLabel[applied.status].toLowerCase()} for this${applied.appliedAt ? ` on ${applied.appliedAt.slice(0, 10)}` : ''}.` }));
  else if (dup) card.append(el('div', { className: 'warn-line', textContent: `You already ${statusLabel[dup.dupOf.status].toLowerCase()} for the same role elsewhere${dup.dupOf.appliedAt ? ` (${dup.dupOf.appliedAt.slice(0, 10)})` : ''}.` }));

  if (single) {
    card.append(roleCard(live[0]));
    if (unsaved.length) {
      const save = el('button', { type: 'button', className: 'btn primary', textContent: 'Save this role' });
      save.addEventListener('click', async () => {
        await saveRecords(unsaved);
      });
      card.append(save);
    }
  } else {
    card.append(el('div', { textContent: `${live.length} roles on this page · ${matches.length} match your filters${unsaved.length ? '' : ' · all saved'}` }));
    if (unsaved.length) {
      const row = el('div', { className: 'row' });
      const saveMatches = el('button', { type: 'button', className: 'btn primary', textContent: `Save ${matches.filter((m) => !stored.has(m.id)).length} matches`, disabled: !matches.some((m) => !stored.has(m.id)) });
      const saveAll = el('button', { type: 'button', className: 'btn', textContent: `Save all ${unsaved.length}` });
      saveMatches.addEventListener('click', () => saveRecords(matches.filter((m) => !stored.has(m.id))));
      saveAll.addEventListener('click', () => saveRecords(unsaved));
      row.append(saveMatches, saveAll);
      card.append(row);
    }
  }
  card.hidden = false;
}

// ---------- scanning the open page on demand ----------
// Chrome only adds Twigg's page reader to pages loaded AFTER the extension (re)loads, so a tab that was
// already open shows nothing. Scanning injects the reader now and asks it to report straight away.

async function scanActivePage({ quiet = false } = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || '')) {
    if (!quiet) notice('Open a job, internship or hackathon page first.', 'warn');
    return;
  }
  $('scan-page').disabled = true;
  try {
    // put the CURRENT reader into the page (it replaces any older copy), read the roles, save them from here
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js', 'content/adapters.js', 'content/detect.js'] });
    const [{ result: raws }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => (window.__twiggCollect ? window.__twiggCollect() : null) });
    if (!Array.isArray(raws)) throw new Error('the page reader did not start');
    const found = raws.length;
    if (found) await recordPageRoles(tab.id, tab.url, raws);
    await refresh();
    $('diagnose').hidden = Boolean(found);
    if (!quiet) {
      notice(
        found
          ? `Found ${found} role${found === 1 ? '' : 's'} on this page.`
          : "Twigg couldn't find job listings on this page. If it is a job page, press “Copy page details” below and paste it into your Claude chat, so Twigg can learn this layout.",
        found ? 'ok' : 'warn'
      );
    }
  } catch (err) {
    if (!quiet) notice(`Twigg can't read this page (${err.message}).`, 'error');
  } finally {
    $('scan-page').disabled = false;
  }
}

$('scan-page').addEventListener('click', () => scanActivePage());

// structure-only report of the open page, for teaching Twigg a layout it can't read yet
$('diagnose').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js', 'content/adapters.js', 'content/detect.js'] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__twiggDiagnose?.() });
    await navigator.clipboard.writeText(JSON.stringify(result, null, 1));
    notice('Copied the page’s structure (link patterns and layout only — no names or text). Paste it into your Claude chat.', 'ok');
  } catch (err) {
    notice(`Couldn't read this page's structure (${err.message}).`, 'error');
  }
});
// opening the Roles tab on a page Twigg hasn't read yet → read it now
document.querySelector('[data-tab="roles"]').addEventListener('click', async () => {
  if ($('page-card').hidden) await scanActivePage({ quiet: true });
});

// ---------- Tracker tab ----------

const PIPELINE = [
  ['active', 'Active', (r) => OPEN_STATUSES.has(r.status)],
  ['saved', 'Shortlisted', (r) => r.status === 'saved'],
  ['applied', 'Applied', (r) => r.status === 'applied'],
  ['oa', 'Online test', (r) => r.status === 'oa'],
  ['interview', 'Interview', (r) => r.status === 'interview'],
  ['offer', 'Offer', (r) => r.status === 'offer'],
  ['rejected', 'Rejected', (r) => r.status === 'rejected'],
];

function renderTracker() {
  const counts = Object.fromEntries(PIPELINE.map(([k, , f]) => [k, state.roles.filter(f).length]));
  viewChips($('pipeline'), PIPELINE, state.trackerView, counts, (k) => {
    state.trackerView = k;
    renderTracker();
  });

  // coming up: shortlisted deadlines within a week, follow-ups due within 3 days
  const today = iso(new Date());
  const items = [];
  for (const r of state.roles) {
    const d = daysUntil(r.deadline);
    if (r.status === 'saved' && d != null && d >= 0 && d <= 7) items.push({ r, when: r.deadline, text: d === 0 ? 'Deadline today' : `Deadline in ${d}d`, n: d });
    if (OPEN_STATUSES.has(r.status) && r.followUpAt) {
      const f = daysUntil(r.followUpAt);
      if (f <= 3) items.push({ r, when: r.followUpAt, text: r.followUpAt <= today ? 'Follow up now' : `Follow up in ${f}d`, n: Math.min(f, 0) });
    }
  }
  items.sort((a, b) => a.n - b.n);
  const box = $('upcoming');
  box.hidden = !items.length;
  box.replaceChildren(
    el('h4', { textContent: 'Coming up' }),
    el('ul', {}, ...items.slice(0, 6).map((i) => el('li', {}, el('a', { href: safeUrl(i.r.url), target: '_blank', rel: 'noopener noreferrer', textContent: i.r.title }), chip(i.text, i.n <= 1 ? 'urgent' : ''))))
  );

  const filter = PIPELINE.find(([k]) => k === state.trackerView)[2];
  const list = state.roles.filter(filter).sort((a, b) => String(a.followUpAt || a.deadline || '9999').localeCompare(String(b.followUpAt || b.deadline || '9999')));
  $('tracker-list').replaceChildren(
    ...(list.length
      ? list.map((r) => roleCard(r, { tracker: true }))
      : [el('li', { className: 'empty-note muted', textContent: 'Nothing here yet. Press ☆ Shortlist or “Applied” on a role in the Roles tab and it shows up here.' })])
  );
}

// ---------- filters form ----------

const csv = (s) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

async function fillFiltersForm() {
  const f = await loadFilters();
  $('f-keywords').value = f.keywords.join(', ');
  $('f-exclude').value = f.exclude.join(', ');
  $('f-minstipend').value = f.minStipend || '';
  $('f-maxdur').value = f.maxDurationMonths || '';
  $('f-locations').value = f.locations.join(', ');
  $('f-batch').value = f.batchYear || '';
  $('f-remote').checked = f.remoteOnly;
}

$('filters-toggle').addEventListener('click', async () => {
  const open = $('filters-box').hidden;
  $('filters-box').hidden = !open;
  $('filters-toggle').setAttribute('aria-expanded', String(open));
  if (open) await fillFiltersForm();
});

$('filters-box').addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveFilters({
    keywords: csv($('f-keywords').value),
    exclude: csv($('f-exclude').value),
    minStipend: Number($('f-minstipend').value) || 0,
    maxDurationMonths: Number($('f-maxdur').value) || 0,
    locations: csv($('f-locations').value),
    batchYear: $('f-batch').value.trim(),
    remoteOnly: $('f-remote').checked,
  });
  notice(`Filters saved — ${state.roles.length} roles re-checked.`);
});

$('f-reset').addEventListener('click', async () => {
  await chrome.storage.local.remove('filters');
  await reevaluateAll();
  await fillFiltersForm();
  notice('Filters reset to defaults.');
});

// ---------- toolbar actions ----------

$('auto-collect').addEventListener('change', (e) => saveSettings({ autoCollect: e.target.checked }));
$('role-search').addEventListener('input', (e) => {
  state.query = e.target.value;
  renderRoles();
});

$('export-csv').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([toCSV(sorted(state.roles))], { type: 'text/csv' }));
  Object.assign(document.createElement('a'), { href: url, download: `twigg-roles-${iso(new Date())}.csv` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('score-stop').addEventListener('click', () => (state.stop = true));
$('score-all').addEventListener('click', async () => {
  const batch = sorted(state.roles.filter((r) => INBOX(r) && r.kind === 'job' && r.eval?.verdict !== 'skip' && !r.fit)).slice(0, 8);
  if (!batch.length) return;
  state.scoring = true;
  state.stop = false;
  $('score-all').disabled = true;
  $('score-stop').hidden = false;
  const result = await scoreMany(
    batch.map((r) => r.id),
    (done, total) => notice(`Rating fit… ${done}/${total}`),
    () => state.stop
  );
  state.scoring = false;
  $('score-stop').hidden = true;
  notice(result.stopped ? `Rated ${result.done}. ${result.stopped}` : `Rated ${result.done} role${result.done === 1 ? '' : 's'}.`, result.stopped ? 'warn' : 'ok');
  await refresh();
});

// ---------- refresh ----------

async function refresh() {
  state.roles = await getAllRoles();
  renderRoles();
  renderTracker();
  await renderPageCard();
}

(async () => {
  $('auto-collect').checked = (await getSettings()).autoCollect;
  await refresh();
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.rolesVersion) refresh();
  if (area === 'local' && changes.settings) getSettings().then((s) => ($('auto-collect').checked = s.autoCollect));
  if (area === 'session' && Object.keys(changes).some((k) => k.startsWith('page:'))) renderPageCard();
});
chrome.tabs.onActivated.addListener(renderPageCard);
chrome.tabs.onUpdated.addListener((_id, change, tab) => tab.active && change.status === 'complete' && renderPageCard());
// deadlines move with the calendar
setInterval(() => document.visibilityState === 'visible' && refresh(), 5 * 60 * 1000);
