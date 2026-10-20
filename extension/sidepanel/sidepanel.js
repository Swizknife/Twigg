import { stream, primaryProvider } from '../lib/llm.js';
import { getSettings, onSettingsChanged } from '../lib/settings.js';
import { loadProfile, isProfileFilled, profileForAI, onProfileChanged } from '../lib/profile.js';
import { chatSystem, QUICK_PROMPTS } from '../lib/prompts.js';
import { renderMarkdown } from '../ui/markdown.js';
import './fill.js';
import './roles-ui.js';
import './post-ui.js';
import './tailor-ui.js';
import './outreach-ui.js';
import './gap-ui.js';

const $ = (id) => document.getElementById(id);

// Small local models have short context windows; send them less page text.
const PAGE_CHARS = { gemini: 60000, ollama: 12000 };
const MAX_HISTORY = 12;

const state = {
  profile: {},
  history: [], // [{ role, content }]
  controller: null,
};

// ---------- tabs ----------

for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('[role="tab"]')) t.setAttribute('aria-selected', t === tab);
    for (const panel of document.querySelectorAll('[role="tabpanel"]')) panel.hidden = panel.id !== `tab-${tab.dataset.tab}`;
  });
}

$('open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

function openProfile() {
  chrome.tabs.create({ url: chrome.runtime.getURL('editor/editor.html') });
}
$('open-profile').addEventListener('click', openProfile);
$('profile-link').addEventListener('click', (e) => {
  e.preventDefault();
  openProfile();
});

// ---------- provider badge ----------

function renderBadge(settings) {
  const badge = $('provider-badge');
  let text = 'Gemini';
  let cls = 'ok';
  if (settings.provider === 'ollama') text = 'Ollama · private';
  else if (!settings.geminiKey) {
    text = settings.provider === 'gemini' ? 'No Gemini key' : 'Ollama · private';
    cls = settings.provider === 'gemini' ? 'warn' : 'ok';
  } else if (settings.provider === 'auto') text = 'Gemini → Ollama';
  badge.textContent = text;
  badge.className = `badge ${cls}`;
}

// ---------- current page ----------

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refreshPageTitle() {
  const tab = await activeTab();
  $('page-title').textContent = tab?.title || '';
  $('page-title').title = tab?.url || '';
}

chrome.tabs.onActivated.addListener(refreshPageTitle);
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (tab.active && (change.title || change.status === 'complete')) refreshPageTitle();
});

async function readPage() {
  const tab = await activeTab();
  if (!tab?.id || !/^(https?|file):/.test(tab.url || '')) {
    throw new Error("Twigg can't read this tab (browser or system page).");
  }
  const maxChars = PAGE_CHARS[await primaryProvider()];
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js'] });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (n) => window.TwiggExtract.page(n),
      args: [maxChars],
    });
    return result;
  } catch (err) {
    throw new Error(`Twigg can't read this page (${err.message}).`);
  }
}

// ---------- messages ----------

function clearEmptyState() {
  document.querySelector('.empty-state')?.remove();
}

function addMessage(role, text) {
  clearEmptyState();
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  const body = document.createElement('div');
  body.className = 'body';
  if (role === 'user') body.textContent = text;
  el.append(body);
  $('messages').append(el);
  scrollToBottom();
  return el;
}

function scrollToBottom() {
  const box = $('messages');
  box.scrollTop = box.scrollHeight;
}

function addMeta(el, { provider, reply, note }) {
  const meta = document.createElement('div');
  meta.className = 'meta';
  if (provider) meta.append(provider === 'ollama' ? 'Ollama (local)' : 'Gemini');
  if (note) meta.append(` · ${note}`);
  if (reply) {
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(reply);
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy'), 1200);
    });
    meta.append(copy);
  }
  el.append(meta);
}

function showError(el, err) {
  el.classList.remove('pending');
  const body = el.querySelector('.body');
  body.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'error';
  msg.textContent = err.message;
  body.append(msg);
  if (err.hint) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = err.hint;
    body.append(hint);
  }
}

function setBusy(busy) {
  $('send').disabled = busy;
  $('stop').hidden = !busy;
}

// ---------- chat ----------

async function send(text) {
  text = text.trim();
  if (!text || state.controller) return;
  $('input').value = '';
  addMessage('user', text);

  const reply = addMessage('assistant', '');
  reply.classList.add('pending');
  state.controller = new AbortController();
  setBusy(true);

  let page = null;
  let note = '';
  if ($('use-page').checked) {
    try {
      page = await readPage();
      if (page.truncated) note = 'long page, trimmed';
    } catch (err) {
      note = err.message;
    }
  }

  const messages = [...state.history, { role: 'user', content: text }].slice(-MAX_HISTORY);
  const system = chatSystem({ profile: profileForAI(state.profile), page });
  let answer = '';
  let provider;
  let frame = 0;

  try {
    for await (const chunk of stream({
      system,
      messages,
      signal: state.controller.signal,
      onProvider: (p) => (provider = p),
    })) {
      answer += chunk;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        reply.querySelector('.body').innerHTML = renderMarkdown(answer);
        scrollToBottom();
      });
    }
    cancelAnimationFrame(frame);
    reply.querySelector('.body').innerHTML = renderMarkdown(answer || '_(empty reply)_');
    reply.classList.remove('pending');
    state.history.push({ role: 'user', content: text }, { role: 'assistant', content: answer });
    addMeta(reply, { provider, reply: answer, note });
  } catch (err) {
    cancelAnimationFrame(frame);
    if (err.name === 'AbortError') {
      reply.classList.remove('pending');
      reply.querySelector('.body').innerHTML = renderMarkdown(answer || '_Stopped._');
      if (answer) state.history.push({ role: 'user', content: text }, { role: 'assistant', content: answer });
    } else {
      showError(reply, err);
    }
  } finally {
    state.controller = null;
    setBusy(false);
    scrollToBottom();
  }
}

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  send($('input').value);
});

$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send($('input').value);
  }
});

$('stop').addEventListener('click', () => state.controller?.abort());

$('new-chat').addEventListener('click', () => {
  state.controller?.abort();
  state.history = [];
  $('messages').innerHTML = '';
});

for (const prompt of QUICK_PROMPTS) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.textContent = prompt.label;
  chip.addEventListener('click', () => send(prompt.text));
  $('quick-prompts').append(chip);
}

// ---------- init ----------

async function refreshProfile() {
  const { profile } = await loadProfile();
  state.profile = profile;
  $('profile-warning').hidden = isProfileFilled(profile);
}

(async () => {
  renderBadge(await getSettings());
  onSettingsChanged(renderBadge);
  refreshPageTitle();
  await refreshProfile();
  onProfileChanged(refreshProfile);
  $('input').focus();
})();
