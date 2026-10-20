// The Post tab: LinkedIn drafts from your notes (and optionally the page you're on).

import { POST_TYPES, generatePosts, refinePost } from '../lib/post.js';
import { primaryProvider } from '../lib/llm.js';

const $ = (id) => document.getElementById(id);
const MAX_POST = 3000;
const PAGE_CHARS = { gemini: 12000, ollama: 5000 };
const TWEAKS = [
  ['Shorter', 'Make it about 30% shorter. Keep the strongest detail.'],
  ['More casual', 'Make the tone more casual and conversational, like talking to a friend in the field.'],
  ['Stronger opening', 'Rewrite only the first line so it is more specific and makes people want to read on. Keep the rest.'],
  ['End with a question', 'End with one genuine, specific question for the readers, placed before the hashtags.'],
];

const state = { variants: [], busy: false };

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

// ---------- saved draft (so closing the panel doesn't lose your notes) ----------

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local
      .set({ postDraft: { type: $('post-type').value, notes: $('post-notes').value, link: $('post-link').value, length: $('post-length').value, tone: $('post-tone').value, variants: state.variants } })
      .catch(() => {});
  }, 400);
}

// ---------- reading the current page ----------

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refreshPageTitle() {
  const tab = await activeTab();
  $('post-page-title').textContent = tab?.title || '';
}
chrome.tabs.onActivated.addListener(refreshPageTitle);
chrome.tabs.onUpdated.addListener((_i, c, t) => t.active && c.title && refreshPageTitle());

/** Page text for the AI. GitHub repo pages get a purpose-built summary (name, description, topics, README). */
async function readPage() {
  const tab = await activeTab();
  if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error("Twigg can't read this tab. Open the project page first, or untick “Also use this page”.");
  const maxChars = PAGE_CHARS[await primaryProvider()];
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js'] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (max) => {
      const meta = (n) => document.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.content?.trim() || '';
      const readme = document.querySelector('article.markdown-body');
      if (location.hostname === 'github.com' && readme) {
        const topics = [...document.querySelectorAll('a.topic-tag')].map((a) => a.textContent.trim()).filter(Boolean);
        const text = [`Repository: ${location.pathname.split('/').slice(1, 3).join('/')}`, `Description: ${meta('og:description')}`, topics.length ? `Topics: ${topics.join(', ')}` : '', `README:\n${readme.innerText.replace(/\n{3,}/g, '\n\n').trim()}`].filter(Boolean).join('\n');
        return { title: document.title, url: location.href, text: text.slice(0, max), kind: 'github' };
      }
      const p = window.TwiggExtract.page(max);
      return { title: p.title, url: p.url, text: p.text, kind: 'page' };
    },
    args: [maxChars],
  });
  return result;
}

// ---------- inserting into LinkedIn ----------

const isLinkedIn = (url) => {
  try {
    return /(^|\.)linkedin\.com$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, change) => id === tabId && change.status === 'complete' && done();
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(done, 15000);
  });
}

async function insertIntoLinkedIn(text) {
  await navigator.clipboard.writeText(text).catch(() => {}); // always keep a copy on the clipboard as a fallback
  let tab = await activeTab();
  if (!tab?.url || !isLinkedIn(tab.url)) {
    tab = await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/' });
    await waitForLoad(tab.id);
    await new Promise((r) => setTimeout(r, 1500)); // LinkedIn builds its feed after load
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/composer.js'] });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (t) => window.TwiggComposer.insert(t), args: [text] });
  return result;
}

const INSERT_MESSAGES = {
  'composer-not-found': "Couldn't find LinkedIn's post box, so the draft is copied instead. Click “Start a post” on LinkedIn and press Ctrl+V.",
  'composer-not-empty': 'Your LinkedIn post box already has text, so Twigg left it alone. The draft is copied — paste it where you want.',
  'insert-failed': "LinkedIn didn't accept the text, so the draft is copied instead. Click inside the post box and press Ctrl+V.",
};

// ---------- drafts ----------

function say(id, text) {
  $(id).hidden = !text;
  $(id).textContent = text || '';
}

function draftCard(index) {
  const v = state.variants[index];
  const area = el('textarea', { value: v.text, rows: 10, spellcheck: true });
  const count = el('span', { className: 'count muted' });
  const note = el('div', { className: 'notice', hidden: true });
  const updateCount = () => {
    count.textContent = `${area.value.length} / ${MAX_POST}`;
    count.classList.toggle('over', area.value.length > MAX_POST);
  };
  updateCount();
  area.addEventListener('input', () => {
    v.text = area.value;
    updateCount();
    persist();
  });

  const showNote = (text, kind = 'ok') => {
    note.hidden = !text;
    note.className = `notice ${kind}`;
    note.textContent = text;
  };
  // things the AI likes to add that you never said (numbers, durations, plans) — say so up front
  if (v.warnings?.length) showNote(`Check before posting — not in your notes: ${v.warnings.join('; ')}. Delete or fix anything the AI made up.`, 'warn');

  const copy = el('button', { type: 'button', className: 'btn', textContent: 'Copy' });
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(area.value);
    copy.textContent = 'Copied ✓';
    setTimeout(() => (copy.textContent = 'Copy'), 1400);
  });

  const insert = el('button', { type: 'button', className: 'btn primary', textContent: 'Insert into LinkedIn' });
  insert.addEventListener('click', async () => {
    insert.disabled = true;
    showNote('');
    try {
      const result = await insertIntoLinkedIn(area.value);
      if (result?.ok) showNote("Draft is in LinkedIn's post box. Read it, edit if you like, and press Post yourself.", 'ok');
      else showNote(INSERT_MESSAGES[result?.reason] || 'Copied to your clipboard — paste it into LinkedIn.', 'warn');
    } catch (err) {
      showNote(`Copied to your clipboard, but couldn't reach LinkedIn: ${err.message}`, 'warn');
    } finally {
      insert.disabled = false;
    }
  });

  const tweaks = el('div', { className: 'tweaks' });
  for (const [label, instruction] of TWEAKS) {
    const b = el('button', { type: 'button', textContent: label });
    b.addEventListener('click', async () => {
      if (state.busy) return;
      state.busy = true;
      b.textContent = '…';
      try {
        v.text = await refinePost(area.value, instruction, $('post-link').value.trim());
        area.value = v.text;
        updateCount();
        persist();
      } catch (err) {
        showNote(`${err.message}${err.hint ? ` — ${err.hint}` : ''}`, 'error');
      } finally {
        b.textContent = label;
        state.busy = false;
      }
    });
    tweaks.append(b);
  }

  return el('div', { className: 'draft' }, el('div', { className: 'draft-head' }, el('strong', { textContent: v.angle || `Draft ${index + 1}` }), count), area, el('div', { className: 'row' }, insert, copy), tweaks, note);
}

function renderDrafts() {
  $('post-results').replaceChildren(...state.variants.map((_, i) => draftCard(i)));
}

async function write() {
  if (state.busy) return;
  say('post-error', '');
  state.busy = true;
  $('post-write').disabled = true;
  say('post-progress', 'Reading your notes…');
  try {
    let page = null;
    if ($('post-use-page').checked) {
      say('post-progress', 'Reading this page…');
      page = await readPage();
      if (!$('post-link').value.trim() && page.kind === 'github') $('post-link').value = page.url;
    }
    say('post-progress', 'Writing drafts — a local model can take a minute…');
    state.variants = await generatePosts({
      typeId: $('post-type').value,
      notes: $('post-notes').value,
      page,
      tone: $('post-tone').value,
      length: $('post-length').value,
      link: $('post-link').value.trim(),
    });
    renderDrafts();
    persist();
  } catch (err) {
    say('post-error', `${err.message}${err.hint ? ` — ${err.hint}` : ''}`);
  } finally {
    say('post-progress', '');
    state.busy = false;
    $('post-write').disabled = false;
  }
}

// ---------- init ----------

function showHint() {
  const t = POST_TYPES.find((x) => x.id === $('post-type').value) || POST_TYPES[0];
  $('post-hint').textContent = t.hint;
  $('post-notes').placeholder = t.placeholder;
}

$('post-type').replaceChildren(...POST_TYPES.map((t) => el('option', { value: t.id, textContent: t.label })));
$('post-type').addEventListener('change', () => {
  showHint();
  persist();
});
for (const id of ['post-notes', 'post-link', 'post-length', 'post-tone']) $(id).addEventListener('input', persist);
$('post-write').addEventListener('click', write);

(async () => {
  const { postDraft } = await chrome.storage.local.get('postDraft');
  if (postDraft) {
    $('post-type').value = postDraft.type || POST_TYPES[0].id;
    $('post-notes').value = postDraft.notes || '';
    $('post-link').value = postDraft.link || '';
    $('post-length').value = postDraft.length || 'medium';
    $('post-tone').value = postDraft.tone || 'plain';
    state.variants = postDraft.variants || [];
    renderDrafts();
  }
  showHint();
  refreshPageTitle();
})();
