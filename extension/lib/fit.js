// AI "how well do I fit this role?" scoring. Always on demand — it never runs by itself,
// so the free Gemini quota isn't burnt on every page you open.

import { completeJSON } from './llm.js';
import { fitPrompt } from './prompts.js';
import { loadProfile, profileForAI } from './profile.js';
import { getRole, putRoles } from './store.js';

const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const list = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 3) : []);

export async function scoreRole(id, profileAI) {
  const role = await getRole(id);
  if (!role) throw new Error('That role is no longer saved.');
  const { system, user } = fitPrompt({ profile: profileAI, role });
  const r = await completeJSON({ system, messages: [{ role: 'user', content: user }], temperature: 0.1 });
  role.fit = {
    score: clamp(r.score),
    eligible: ['yes', 'check', 'no'].includes(r.eligible) ? r.eligible : 'check',
    strengths: list(r.strengths),
    gaps: list(r.gaps),
    reason: String(r.reason || '').slice(0, 240),
    confidence: r.confidence === 'high' ? 'high' : 'low',
    at: new Date().toISOString(),
  };
  await putRoles([role]);
  return role.fit;
}

/**
 * Score several roles one after another (gentle on free-tier rate limits).
 * Stops early on a rate-limit error and reports how far it got.
 */
export async function scoreMany(ids, onProgress = () => {}, shouldStop = () => false) {
  const { profile } = await loadProfile();
  const profileAI = profileForAI(profile);
  let done = 0;
  for (const id of ids) {
    if (shouldStop()) break;
    onProgress(done, ids.length);
    try {
      await scoreRole(id, profileAI);
    } catch (err) {
      if (err.status === 429) return { done, stopped: 'Rate limit reached — wait a minute and score the rest.' };
      if (err.name === 'LLMError') return { done, stopped: `${err.message}${err.hint ? ` (${err.hint})` : ''}` };
      // an unusable reply for one role shouldn't stop the others
    }
    done++;
    await new Promise((r) => setTimeout(r, 1200));
  }
  onProgress(done, ids.length);
  return { done };
}
