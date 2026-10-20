// User settings, stored only in this browser (chrome.storage.local).

export const DEFAULTS = {
  provider: 'auto', // 'auto' (Gemini, falls back to Ollama) | 'gemini' | 'ollama' (private mode)
  geminiKey: '',
  geminiModel: 'gemini-3.5-flash', // gemini-2.5-flash was retired for new keys; others are tried automatically
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'gemma3:4b',
  autoCollect: true, // save job/hackathon pages as you open them
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function onSettingsChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) callback({ ...DEFAULTS, ...changes.settings.newValue });
  });
}
