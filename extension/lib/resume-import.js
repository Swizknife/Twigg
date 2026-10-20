// Turn an uploaded resume (PDF or LaTeX) into profile fields.
// The result is only a draft — the profile page shows it for review before anything is saved.

import { completeJSON } from './llm.js';
import { resumeImportPrompt } from './prompts.js';

const MAX_CHARS = 14000; // keeps small local models inside their context window

export async function extractPdfText(buffer) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

  let text = '';
  const links = new Set();
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) text += item.str + (item.hasEOL ? '\n' : ' ');
    text += '\n';
    // Resumes often hide URLs behind words like "GitHub" — read the real link targets.
    for (const a of await page.getAnnotations()) if (a.subtype === 'Link' && a.url) links.add(a.url);
  }
  if (links.size) text += `\nLinks embedded in the document:\n${[...links].join('\n')}`;
  return text.trim();
}

/** Returns a partial profile object extracted from the resume text. */
export async function importFromText(text) {
  if (text.trim().length < 80) {
    throw new Error("Couldn't read any text from this file. If it's a scanned image PDF, upload the .tex or type the details in.");
  }
  const { system, user } = resumeImportPrompt(text.slice(0, MAX_CHARS));
  const result = await completeJSON({ system, messages: [{ role: 'user', content: user }], temperature: 0 });
  if (!result || typeof result !== 'object') throw new Error('The AI returned nothing usable. Try again.');
  return result;
}
