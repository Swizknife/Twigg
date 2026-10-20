import { fillTab } from './lib/autofill.js';
import { getAllRoles } from './lib/store.js';
import { checkReminders } from './lib/reminders.js';
import { recordPageRoles, setRoleBadge, pageKey } from './lib/page-roles.js';

// Twigg service worker: side panel, Alt+F autofill, role collection from pages you open, reminders.

// ---------- side panel ----------

// Some Chromium forks (older Brave builds) lack chrome.sidePanel. Fall back to a tab.
if (chrome.sidePanel) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('Twigg: could not set side panel behavior', err));
} else {
  chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel/sidepanel.html') });
  });
}

// ---------- roles found on pages ----------

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'twigg-roles' && sender.tab?.id != null) {
    recordPageRoles(sender.tab.id, msg.page.url, msg.roles).catch((err) => console.error('Twigg: roles', err));
  }
});

// a new navigation clears what the previous page reported
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' && change.url) {
    chrome.storage.session.remove(pageKey(tabId)).catch(() => {});
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  }
});
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(pageKey(tabId)).catch(() => {}));

// ---------- Alt+F: fill the form on the current tab ----------
// The page highlights show the result; the toolbar badge shows how many fields still need you.

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'fill-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || '')) return;
  const badge = (text, color) => {
    chrome.action.setBadgeBackgroundColor({ color, tabId: tab.id });
    chrome.action.setBadgeText({ text, tabId: tab.id });
    setTimeout(() => setRoleBadge(tab.id), 6000);
  };
  try {
    badge('…', '#5f6a5c');
    const result = await fillTab(tab.id);
    const todo = result.counts.needs + result.counts.check;
    badge(todo ? String(todo) : '✓', todo ? '#d9a400' : '#2f7d4f');
    chrome.runtime.sendMessage({ type: 'twigg-filled', tabId: tab.id, result }).catch(() => {});
  } catch {
    badge('!', '#c0392b');
  }
});

// ---------- reminders ----------

const ALARM = 'twigg-reminders';

chrome.alarms.onAlarm.addListener((alarm) => alarm.name === ALARM && checkReminders().catch((e) => console.error('Twigg: reminders', e)));
chrome.notifications.onClicked.addListener(async (id) => {
  const roleId = id.match(/^role:(.+):\d+$/)?.[1];
  const role = roleId && (await getAllRoles()).find((r) => r.id === roleId);
  if (role?.url) chrome.tabs.create({ url: role.url });
  chrome.notifications.clear(id);
});

const ensureAlarm = () => chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 60 });
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.runtime.onInstalled.addListener(({ reason }) => {
  ensureAlarm();
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
