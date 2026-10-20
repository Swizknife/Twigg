// Deadline and follow-up reminders.
// Deadline alerts: only roles you shortlisted ('saved'). Follow-ups: any open application whose follow-up date has come.
// Each reminder fires once (remembered in role.notified).

import { getAllRoles, putRoles } from './store.js';
import { daysUntil, OPEN_STATUSES } from './roles.js';

const isoDay = (d) => d.toISOString().slice(0, 10);

function notify(role, message) {
  chrome.notifications.create(`role:${role.id}:${Date.now()}`, { type: 'basic', iconUrl: 'icons/icon128.png', title: 'Twigg', message, priority: 1 });
}

/** Returns the messages that were sent. `send` is injectable for tests. */
export async function checkReminders(now = new Date(), send = notify) {
  const roles = await getAllRoles();
  const changed = [];
  const sent = [];
  for (const r of roles) {
    if (!OPEN_STATUSES.has(r.status)) continue;
    const notified = { ...(r.notified || {}) };
    const label = `${r.title}${r.company ? ` — ${r.company}` : ''}`;
    const days = daysUntil(r.deadline, now);

    if (r.status === 'saved' && days != null && days >= 0 && days <= 2 && notified.deadline !== r.deadline) {
      const msg = `Deadline ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in 2 days'}: ${label}`;
      send(r, msg);
      sent.push(msg);
      notified.deadline = r.deadline;
    }
    if (r.followUpAt && r.followUpAt <= isoDay(now) && notified.followUp !== r.followUpAt) {
      const msg = `Time to follow up: ${label}`;
      send(r, msg);
      sent.push(msg);
      notified.followUp = r.followUpAt;
    }
    if (JSON.stringify(notified) !== JSON.stringify(r.notified || {})) changed.push({ ...r, notified });
  }
  await putRoles(changed);
  return sent;
}
