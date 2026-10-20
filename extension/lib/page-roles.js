// What Twigg found on a tab: analysed + saved (when "Collect roles as I browse" is on), remembered for the
// side panel's "On this page" card, and shown on the toolbar badge.
// Used by the background worker (pages report while you browse) and by the side panel's "Scan this page".

import { ingest } from './store.js';
import { getSettings } from './settings.js';

export const pageKey = (tabId) => `page:${tabId}`;

/** What the page's roles look like in the panel: keep list pages small. */
const slim = (rec, isNew, saved) => ({ ...rec, description: (rec.description || '').slice(0, rec.isDetail ? 1500 : 300), isNew, saved });

export async function setRoleBadge(tabId) {
  const state = (await chrome.storage.session.get(pageKey(tabId)))[pageKey(tabId)];
  const roles = state?.roles || [];
  const matches = roles.filter((r) => r.eval?.verdict === 'match').length;
  let text = '';
  let color = '#2f7d4f';
  if (roles.some((r) => r.dupOf || r.status === 'applied')) [text, color] = ['!', '#d9a400'];
  else if (matches) text = String(matches);
  else if (roles.some((r) => r.eval?.verdict === 'maybe')) [text, color] = ['?', '#5f6a5c'];
  await chrome.action.setBadgeBackgroundColor({ color, tabId }).catch(() => {});
  await chrome.action.setBadgeText({ text, tabId }).catch(() => {});
}

/** raws = roles a page reader collected. Returns the ingest results. */
export async function recordPageRoles(tabId, url, raws) {
  const { autoCollect } = await getSettings();
  const results = await ingest(raws, { persist: autoCollect });
  await chrome.storage.session.set({
    [pageKey(tabId)]: { url, at: Date.now(), roles: results.map((r) => slim(r.rec, r.isNew, autoCollect)) },
  });
  await setRoleBadge(tabId);
  return results;
}
