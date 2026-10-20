import { getSettings, saveSettings } from '../lib/settings.js';
import { listModels, testConnection } from '../lib/llm.js';
import { loadProfile, isProfileFilled } from '../lib/profile.js';

const $ = (id) => document.getElementById(id);
const FIELDS = ['geminiKey', 'geminiModel', 'ollamaUrl', 'ollamaModel'];

function readForm() {
  const values = Object.fromEntries(FIELDS.map((f) => [f, $(f).value.trim()]));
  values.provider = document.querySelector('input[name="provider"]:checked')?.value || 'auto';
  return values;
}

async function save() {
  await saveSettings(readForm());
  $('saved').textContent = 'Saved';
  setTimeout(() => ($('saved').textContent = ''), 1500);
}

function setStatus(provider, text, kind) {
  const el = $(`status-${provider}`);
  el.textContent = text;
  el.className = `status ${kind || ''}`;
}

function describe(err) {
  return err.hint ? `${err.message} — ${err.hint}` : err.message;
}

$('save').addEventListener('click', save);

for (const btn of document.querySelectorAll('[data-test]')) {
  btn.addEventListener('click', async () => {
    const provider = btn.dataset.test;
    await save(); // test what's on screen
    setStatus(provider, 'Testing…');
    try {
      const reply = await testConnection(provider);
      setStatus(provider, `Working — replied "${reply.slice(0, 40)}"`, 'ok');
    } catch (err) {
      setStatus(provider, describe(err), 'error');
    }
  });
}

for (const btn of document.querySelectorAll('[data-load]')) {
  btn.addEventListener('click', async () => {
    const provider = btn.dataset.load;
    await save();
    setStatus(provider, 'Loading models…');
    try {
      const models = await listModels(provider);
      $(`${provider}-models`).replaceChildren(...models.map((m) => Object.assign(document.createElement('option'), { value: m })));
      setStatus(provider, `${models.length} models available — click the Model box to pick one.`, 'ok');
    } catch (err) {
      setStatus(provider, describe(err), 'error');
    }
  });
}

$('reload').addEventListener('click', () => chrome.runtime.reload());

async function renderProfileStatus() {
  const { profile, resumes, answers, voice } = await loadProfile();
  const items = [
    [isProfileFilled(profile), isProfileFilled(profile) ? `Details — ${profile.basics.name}` : 'Details — not filled yet'],
    ...(resumes.length
      ? resumes.map((r) => [r.pdf && r.tex, `Resume “${r.label}” — ${[r.pdf ? 'PDF ✓' : 'no PDF', r.tex ? '.tex ✓' : 'no .tex'].join(', ')}`])
      : [[false, 'No resume uploaded yet']]),
    [answers.length > 0, `${answers.length} saved answers`],
    [voice.trim().length > 0, voice.trim() ? 'Writing samples added' : 'Writing samples — none yet'],
  ];
  $('profile-status').replaceChildren(
    ...items.map(([ok, label]) => Object.assign(document.createElement('li'), { className: ok ? 'ok' : 'missing', textContent: label }))
  );
}

(async () => {
  const settings = await getSettings();
  for (const f of FIELDS) $(f).value = settings[f];
  document.querySelector(`input[name="provider"][value="${settings.provider}"]`).checked = true;
  renderProfileStatus();
})();
