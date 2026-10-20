// The Outreach tab: referral DMs, recruiter/professor emails, follow-ups. Draft only — you send it.

import { OUTREACH_TYPES, generateOutreach, refineOutreach, gmailUrl } from '../lib/outreach.js';
import { getAllRoles } from '../lib/store.js';
import { primaryProvider } from '../lib/llm.js';

const $ = (id) => document.getElementById(id);
const PAGE_CHARS = { gemini: 8000, ollama: 4000 };
const TWEAKS = [
  ['Shorter', 'Make it about 30% shorter. Keep the single clearest ask.'],
  ['Warmer', 'Make the tone a little warmer and more personal, without flattery or new facts.'],
  ['More direct', 'Make the ask clearer and more direct. Put it earlier.'],
];
const state = { draft: null, busy: false, roles: [] };

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}
const say = (id, text, kind) => {
  $(id).hidden = !text;
  $(id).textContent = text || '';
  if (kind) $(id).className = `notice ${kind}`;
};
const type = () => OUTREACH_TYPES.find((t) => t.id === $('oc-type').value) || OUTREACH_TYPES[0];

// ---------- saved draft ----------

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({ outreachDraft: { type: $('oc-type').value, notes: $('oc-notes').value, to: $('oc-to').value, tone: $('oc-tone').value, draft: state.draft } }).catch(() => {});
  }, 400);
}

// ---------- the person's page ----------

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
async function refreshPageTitle() {
  $('oc-page-title').textContent = (await activeTab())?.title || '';
}
chrome.tabs.onActivated.addListener(refreshPageTitle);
chrome.tabs.onUpdated.addListener((_i, c, t) => t.active && c.title && refreshPageTitle());

/** Page text plus any email address the page itself displays (mailto links). Never guessed. */
async function readPage() {
  const tab = await activeTab();
  if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error("Twigg can't read this tab. Open the person's page first, or untick “Use this page”.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js'] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (max) => {
      const p = window.TwiggExtract.page(max);
      const emails = [...new Set([...document.querySelectorAll('a[href^="mailto:"]')].map((a) => decodeURIComponent(a.getAttribute('href').slice(7).split('?')[0]).trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !/no-?reply/i.test(e)))];
      return { title: p.title, url: p.url, text: p.text, emails };
    },
    args: [PAGE_CHARS[await primaryProvider()]],
  });
  return result;
}

// ---------- roles ----------

async function loadRoles() {
  state.roles = (await getAllRoles()).filter((r) => r.status !== 'ignored').sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 60);
  const keep = $('oc-role').value;
  $('oc-role').replaceChildren(
    el('option', { value: '', textContent: 'None' }),
    ...state.roles.map((r) => el('option', { value: r.id, textContent: `${r.title}${r.company ? ` — ${r.company}` : ''}${['applied', 'oa', 'interview'].includes(r.status) ? ' (applied)' : ''}` }))
  );
  if ([...$('oc-role').options].some((o) => o.value === keep)) $('oc-role').value = keep;
}
chrome.storage.onChanged.addListener((c, area) => area === 'local' && c.rolesVersion && loadRoles());

// ---------- draft card ----------

function fullText() {
  return type().email ? `Subject: ${$('oc-subject').value}\n\n${$('oc-body').value}` : $('oc-body').value;
}
function updateCount() {
  const n = $('oc-body').value.length;
  const limit = type().id === 'connect' ? 300 : null;
  $('oc-count').textContent = limit ? `${n} / ${limit} characters` : `${n} characters`;
  $('oc-count').classList.toggle('over', Boolean(limit) && n > limit);
}
function showDraft(draft) {
  state.draft = draft;
  const email = type().email;
  $('oc-subject-wrap').hidden = !email;
  $('oc-gmail').hidden = !email;
  $('oc-subject').value = draft.subject || '';
  $('oc-body').value = draft.body;
  updateCount();
  say('oc-warnings', draft.warnings?.length ? `Check before sending — ${draft.warnings.join('; ')}.` : '', 'warn');
  say('oc-note', '');
  $('oc-result').hidden = false;
}

function showHint() {
  const t = type();
  $('oc-hint').textContent = t.hint;
  $('oc-notes').placeholder = t.placeholder;
  $('oc-to-wrap').hidden = !t.email;
}

// ---------- generate ----------

async function write() {
  if (state.busy) return;
  say('oc-error', '');
  state.busy = true;
  $('oc-write').disabled = true;
  say('oc-progress', 'Reading…', 'ok');
  try {
    let page = null;
    if ($('oc-use-page').checked) {
      page = await readPage();
      if (type().email && !$('oc-to').value.trim() && page.emails.length) $('oc-to').value = page.emails[0];
    }
    const role = state.roles.find((r) => r.id === $('oc-role').value) || null;
    say('oc-progress', 'Writing — a local model can take a minute…', 'ok');
    const draft = await generateOutreach({ typeId: $('oc-type').value, notes: $('oc-notes').value, page, role, tone: $('oc-tone').value, link: '' });
    showDraft(draft);
    persist();
  } catch (err) {
    say('oc-error', `${err.message}${err.hint ? ` — ${err.hint}` : ''}`);
  } finally {
    say('oc-progress', '');
    state.busy = false;
    $('oc-write').disabled = false;
  }
}

// ---------- actions ----------

$('oc-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(fullText());
  $('oc-copy').textContent = 'Copied ✓';
  setTimeout(() => ($('oc-copy').textContent = 'Copy'), 1400);
});

$('oc-gmail').addEventListener('click', async () => {
  const { url, bodyIncluded } = gmailUrl({ to: $('oc-to').value.trim(), subject: $('oc-subject').value, body: $('oc-body').value });
  if (!bodyIncluded) await navigator.clipboard.writeText($('oc-body').value).catch(() => {});
  await chrome.tabs.create({ url });
  say('oc-note', bodyIncluded ? 'Gmail opened with the draft. Read it, add the recipient if it is blank, and press Send yourself.' : 'Gmail opened with the subject. The message was too long for the link, so it is copied — paste it in.', 'ok');
});

for (const [label, instruction] of TWEAKS) {
  const b = el('button', { type: 'button', textContent: label });
  b.addEventListener('click', async () => {
    if (state.busy || !state.draft) return;
    state.busy = true;
    b.textContent = '…';
    try {
      const next = await refineOutreach({ subject: $('oc-subject').value, body: $('oc-body').value }, instruction, $('oc-type').value);
      // keep the warnings honest: re-check the revised text against what we know
      const { outreachWarnings } = await import('../lib/outreach.js');
      showDraft({ ...next, subject: next.subject || $('oc-subject').value, warnings: outreachWarnings({ subject: next.subject || $('oc-subject').value, body: next.body }, { type: type(), sources: `${$('oc-notes').value} ${state.draft.body} ${state.draft.subject}`, notes: $('oc-notes').value }) });
      persist();
    } catch (err) {
      say('oc-error', `${err.message}${err.hint ? ` — ${err.hint}` : ''}`);
    } finally {
      b.textContent = label;
      state.busy = false;
    }
  });
  $('oc-tweaks').append(b);
}

// ---------- init ----------

$('oc-type').replaceChildren(...OUTREACH_TYPES.map((t) => el('option', { value: t.id, textContent: t.label })));
$('oc-type').addEventListener('change', () => {
  showHint();
  if (state.draft) showDraft({ ...state.draft, warnings: [] }); // subject/Gmail controls follow the type
  persist();
});
for (const id of ['oc-notes', 'oc-to', 'oc-tone']) $(id).addEventListener('input', persist);
$('oc-subject').addEventListener('input', persist);
$('oc-body').addEventListener('input', () => {
  if (state.draft) state.draft.body = $('oc-body').value;
  updateCount();
  persist();
});
$('oc-write').addEventListener('click', write);

(async () => {
  await loadRoles();
  const { outreachDraft: saved } = await chrome.storage.local.get('outreachDraft');
  if (saved) {
    $('oc-type').value = saved.type || OUTREACH_TYPES[0].id;
    $('oc-notes').value = saved.notes || '';
    $('oc-to').value = saved.to || '';
    $('oc-tone').value = saved.tone || 'warm';
    showHint();
    if (saved.draft) showDraft(saved.draft);
  }
  showHint();
  refreshPageTitle();
})();
