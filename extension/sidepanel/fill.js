// The Fill tab: runs lib/autofill.js on the current tab and shows what needs your attention.

import { fillTab, clearHighlights, focusField, collectAnswers, rememberAnswers, attachResume } from '../lib/autofill.js';

const $ = (id) => document.getElementById(id);
let last = { tabId: null, attention: [], resumeChoice: null };

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function showError(message) {
  $('fill-error').hidden = !message;
  $('fill-error').textContent = message || '';
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(Boolean));
  return node;
}

/** "Which resume should I attach?" — shown whenever the form has a resume upload and you have several resumes. */
function renderResumeChoice(choice) {
  $('resume-choice').hidden = !choice;
  $('resume-attach-note').hidden = true;
  $('resume-attach').disabled = true;
  if (!choice) return;
  $('resume-options').replaceChildren(
    ...choice.resumes.map((r) => {
      const radio = el('input', { type: 'radio', name: 'resume-pick', value: r.id });
      radio.addEventListener('change', () => ($('resume-attach').disabled = false));
      return el('label', {}, radio, el('span', {}, el('strong', { textContent: r.label }), ' ', el('span', { className: 'file', textContent: r.file })));
    })
  );
}

$('resume-attach').addEventListener('click', async () => {
  const picked = document.querySelector('input[name="resume-pick"]:checked')?.value;
  if (!picked || !last.resumeChoice) return;
  const note = $('resume-attach-note');
  $('resume-attach').disabled = true;
  try {
    const results = await attachResume(last.tabId, last.resumeChoice.slots, picked);
    const ok = results.every((r) => r.status !== 'needs');
    const label = last.resumeChoice.resumes.find((r) => r.id === picked)?.label;
    note.className = `notice ${ok ? 'ok' : 'error'}`;
    note.textContent = ok ? `Attached “${label}”. Check the upload field before you submit.` : results.find((r) => r.status === 'needs')?.note || 'The site would not accept the file — upload it yourself.';
    note.hidden = false;
    // the resume upload no longer needs you (the site may have rebuilt the field, so match by its note too)
    if (ok) {
      const done = new Set(results.map((r) => `${r.frameId}:${r.id}`));
      last.attention = last.attention.filter((a) => !done.has(`${a.frameId}:${a.id}`) && !/Choose which resume/.test(a.note));
      renderAttention(last.attention);
    }
  } catch (err) {
    note.className = 'notice error';
    note.textContent = err.message;
    note.hidden = false;
  } finally {
    $('resume-attach').disabled = false;
  }
});

function renderAttention(attention) {
  $('attention-title').hidden = !attention.length;
  $('attention').replaceChildren(
    ...attention.map((a) => {
      const li = el(
        'li',
        {},
        el('i', { className: `dot ${a.status === 'needs' ? 'red' : 'yellow'}` }),
        el('span', {}, `${a.label}${a.required ? ' *' : ''}`, a.note ? el('span', { className: 'why', textContent: a.note }) : null)
      );
      li.addEventListener('click', () => focusField(last.tabId, a.frameId, a.id));
      return li;
    })
  );
}

function render({ counts, attention, notes, resumeChoice }) {
  $('fill-result').hidden = false;
  renderResumeChoice(resumeChoice);

  const chips = [
    ['filled', counts.filled, 'filled'],
    ['check', counts.check, 'to check'],
    ['needs', counts.needs, 'need you'],
    ['', counts.skipped, 'optional, left empty'],
    ['', counts.existing, 'already had text'],
  ].filter(([, n]) => n);
  $('fill-counts').replaceChildren(...chips.map(([cls, n, text]) => el('span', { className: `count ${cls}`, textContent: `${n} ${text}` })));

  $('fill-notes').replaceChildren(...notes.map((n) => el('div', { className: 'notice warn', textContent: n })));
  renderAttention(attention);
  $('remember-box').hidden = true;
}

async function run() {
  showError('');
  $('fill-progress').hidden = true;
  const tab = await activeTab();
  if (!tab?.id || !/^https?:/.test(tab.url || '')) return showError("Twigg can't fill this tab (browser or system page). Open the application form first.");

  $('fill-run').disabled = true;
  try {
    const result = await fillTab(
      tab.id,
      { useAI: $('fill-ai').checked, overwrite: $('fill-overwrite').checked },
      (msg) => {
        $('fill-progress').hidden = false;
        $('fill-progress').textContent = msg;
      }
    );
    last = { tabId: tab.id, attention: result.attention, resumeChoice: result.resumeChoice };
    render(result);
  } catch (err) {
    showError(err.message);
  } finally {
    $('fill-progress').hidden = true;
    $('fill-run').disabled = false;
  }
}

async function openRemember() {
  const values = await collectAnswers(last.tabId, last.attention);
  if (!values.length) return showError("Nothing to remember yet — fill the red or yellow fields yourself first, then click this.");
  showError('');
  $('remember-list').replaceChildren(
    ...values.map((v) => {
      const box = el('input', { type: 'checkbox', checked: v.status === 'needs' });
      box.dataset.label = v.label;
      box.dataset.value = v.value;
      return el('li', {}, el('label', {}, box, el('span', {}, v.label, el('span', { className: 'v', textContent: v.value.length > 120 ? `${v.value.slice(0, 120)}…` : v.value }))));
    })
  );
  $('remember-box').hidden = false;
}

$('fill-run').addEventListener('click', run);
$('fill-clear').addEventListener('click', async () => {
  if (last.tabId != null) await clearHighlights(last.tabId);
});
$('fill-remember').addEventListener('click', openRemember);
$('remember-cancel').addEventListener('click', () => ($('remember-box').hidden = true));
$('remember-save').addEventListener('click', async () => {
  const chosen = [...$('remember-list').querySelectorAll('input:checked')].map((b) => ({ label: b.dataset.label, value: b.dataset.value }));
  if (chosen.length) await rememberAnswers(chosen);
  $('remember-box').hidden = true;
  $('fill-notes').replaceChildren(el('div', { className: 'notice ok', textContent: `Saved ${chosen.length} answer${chosen.length === 1 ? '' : 's'}. Twigg will reuse them on matching questions.` }));
});

// Alt+F in the background fills the page without the panel open; keep the panel in sync if it's open.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'twigg-filled') {
    last = { tabId: msg.tabId, attention: msg.result.attention, resumeChoice: msg.result.resumeChoice };
    render(msg.result);
  }
});
