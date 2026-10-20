# Twigg 🌱

A job-hunt copilot for Chrome, Brave and Edge. It lives in your browser's side panel and knows your resume.

| Feature | Status |
|---|---|
| Your profile: upload a resume (PDF / .tex), AI reads it, you review and save. Update any time | ✅ |
| Chat about the page you're on (summaries, eligibility, missing skills, interview prep) | ✅ |
| Autofill application forms — never submits, never ticks consent boxes | ✅ |
| Collect, filter and AI-rate roles and hackathons as you browse; tracker, deadlines, reminders | ✅ |
| LinkedIn post writer (from notes or a GitHub/project page, inserted into the post box — never posts) | ✅ |
| Resume tailoring: keyword match score, honest gap analysis, validated bullet rewrites, tailored `.tex` for Overleaf | ✅ |
| Outreach drafts (referral DM, connection note, recruiter / professor email, follow-up) and a skill-gap report | ✅ |

All your data stays in this browser on your laptop. The AI is free: Gemini's free API key and/or Ollama running locally.

---

## 1. Install the extension (2 minutes)

1. Open `brave://extensions` (Chrome: `chrome://extensions`, Edge: `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the `Twigg/extension` folder.
4. Pin Twigg to the toolbar. Click the icon or press **Alt+T** to open the side panel.

After changing any Twigg code, press the ↻ reload button on its card in `brave://extensions`.

## 2. Set up the AI

### Gemini (recommended, free)
1. Go to <https://aistudio.google.com/apikey> and create an API key (newer keys start with `AQ.`, older ones with `AIza`).
2. Paste it in Twigg settings (⚙), choose **Gemini only**, press **Save settings**, then **Test Gemini**. The default model is `gemini-3.5-flash`.
3. Google retires and overloads models often. If the chosen model is retired, busy or silent for 25 s, Twigg automatically tries `gemini-3.5-flash`, `gemini-flash-latest` and `gemini-flash-lite-latest` before giving up. A wrong key fails straight away with a clear message.

> On the free tier, Google may use prompts to improve its products. Twigg never sends your phone, email, address, DOB or roll number to the AI. Use **Ollama only (private mode)** for anything sensitive.

### Ollama (local, private)
Ollama blocks browser extensions by default. Run this once in PowerShell:

```powershell
setx OLLAMA_ORIGINS "chrome-extension://*"
```

Then **quit Ollama from the system tray and start it again**. The setting only applies to newly started processes.

Recommended model for a CPU-only laptop: `gemma3:4b`. In settings, click **Test Ollama**.

## 3. Add your resume (and update it any time)

Click 👤 in the side panel (or ⚙ → *Open profile & resume*). You can keep **one resume per role** (up to 4) — e.g. "AI Engineering" and "Edge AI":

1. Type which role the resume is for, then **Upload PDF** (attached to "upload resume" fields) and **Upload .tex** (used for tailoring).
2. Twigg **reads the file straight away** and fills in what that resume shows (skills, projects, experience…) plus your shared details. Everything it filled is **highlighted in yellow**. Check it, then press **Save** — nothing is saved before that.
3. **+ Add another resume** for your next role. Each resume keeps its own projects and skills; the rest of Twigg (chat, fit scores, posts, outreach) uses everything from all of them.
4. In **About you** (shared by every resume) fill the rest once: date of birth, 10th/12th %, address, preferences. Leave a field empty if it doesn't apply — Twigg never guesses it.

When a resume changes, upload the new file on its card (**Replace PDF**). If the browser can't save (for example, your disk is full) you get a clear message saying so. Use **Export backup** to keep a copy or move your data to another browser.

## 4. Autofill

Open an application form, then **Fill** tab → **Fill this page** (or press **Alt+F**).

- 🟢 filled from your profile · 🟡 check it (AI-written, converted, or a guessed date format) · 🔴 needs you
- Click an item in the list to jump to that field.
- Fills what your profile answers directly; only the leftovers go to the AI, in one request.
- Skips fields that already have text (tick *Overwrite* to change that).
- **Resume uploads:** with one resume, its PDF is attached. With two or more, Twigg **asks every time** — the upload field stays red and the Fill tab shows *"Which resume should I attach?"*. Pick one and press **Attach**.
- Multi-page forms (Workday etc.): click Next yourself, then Fill again.
- After you fill the red fields yourself, click **Remember my answers** so Twigg reuses them next time.

Known limits: custom dropdowns (react-select style) and sites that block file uploads are left for you and shown red. Google Forms support is tested on a model of its structure, not yet on live forms.

## 5. Roles & tracker

Just browse. When you open a job, internship or hackathon page — or a search results page — Twigg reads what is already on it (nothing is crawled, nothing leaves your laptop) and saves it under **Roles**. The toolbar badge shows how many matches the page has (`!` = you already applied to it).

- **Matches / Maybe / Skipped**: your filters decide. Open **Filters** to set keywords (defaults cover AI / ML / edge / embedded / vision…), words to skip (sales, marketing…), minimum stipend, maximum duration, locations, remote-only and your graduation year. Changing filters re-checks everything saved.
- **Red flags** are shown on the card: asks for a fee (auto-skipped), asks you to apply via WhatsApp/Telegram, unpaid, performance-only pay, hidden company, deadline passed, a posting that names a batch that isn't yours.
- **Rate fit** (per role, or "Rate fit for matches" for a few at a time): the AI compares the posting with your profile and gives a 0–100 score, strengths, gaps and eligibility. It only runs when you ask, so the free Gemini quota isn't wasted.
- **☆ Shortlist** the ones you care about (they get deadline reminders), **Applied** moves one to the **Tracker** with a follow-up date 7 days out.
- **Tracker**: status (Shortlisted → Applied → Online test → Interview → Offer / Rejected), deadline, follow-up date, notes. A "Coming up" box lists deadlines and follow-ups due soon. Browser notifications fire once per deadline (shortlisted roles only) and once per follow-up.
- **Duplicates**: the same company + title seen on another site after you applied shows "Already applied elsewhere".
- Turn **Collect roles as I browse** off if you'd rather save pages by hand (the "On this page" card has Save buttons). **Export CSV** gives you a spreadsheet.

| Site | List pages | Single-job pages | Checked against |
|---|---|---|---|
| Naukri | ✅ | ✅ structured data | real page snapshot |
| Indeed | ✅ | ✅ structured data | real page snapshot |
| Unstop (jobs, internships) | ✅ | ✅ structured data | real page snapshot |
| Greenhouse boards | ✅ | ✅ | real page snapshot |
| LinkedIn (signed out) | ✅ | ✅ structured data | structure observed live, test page reconstructed |
| LinkedIn (signed in) | best effort | best effort | not tested — selectors are guesses |
| Internshala | ✅ cards | DOM reader | list structure observed live; detail page **not verified** |
| Y Combinator jobs (ycombinator.com/jobs) | ✅ (title, company, type, place, yearly salary) | best effort | real page snapshot |
| Work at a Startup (workatastartup.com) | ✅ | ✅ | public pages observed live (jobs list, company page, job page); the signed-in search layout is **reconstructed from a screenshot, not tested live** |
| Lever, Workday, hackathon sites (Devfolio, Kaggle, MLH…) | best effort | best effort | not tested on live pages |
| Any other site | — | ✅ if it publishes standard JobPosting data | — |

Sites change their markup without notice. If a page shows no roles:

1. Open the **Roles** tab and press **Scan this page** (it also scans automatically when you open the tab). Twigg only reads pages loaded after it starts, so scanning handles tabs that were already open.
2. If it still finds nothing, press **Copy page details (no personal info)**. That copies only the page's link patterns and layout — no names, text or personal data — which is what you need to teach Twigg the layout (open an issue with it, or add a reader in `extension/content/adapters.js`). Many sites need only a few lines there.

## 6. LinkedIn posts

**Post** tab → pick a type (project launch, joined an internship, certificate, hackathon, learning milestone, research, other) → type rough notes → **Write 2 drafts**.

- Twigg only uses facts from your notes (and the page, if you tick *Also use this page* on a GitHub repo, project or certificate page). The AI is told never to invent numbers, results, durations or plans — but AI models do it anyway, so **read every draft before posting**. Twigg underlines the risk: if a draft contains a number, a time span ("the last few weeks"), a future plan or a word like "significantly" that isn't in your notes, a yellow note lists it above the Insert button.
- Drafts copy *how* you write, not *what* you wrote. Twigg measures your writing samples on your own machine (sentence length, casualness, emojis, British/American spelling) and sends only that short description to the AI — never the posts themselves. Small models otherwise borrow details from samples. Add 2–3 of your own posts to your profile for the best match.
- The small local model (`gemma3:4b`) follows the rules less strictly than Gemini does. For posts, Gemini gives noticeably more faithful drafts.
- Tweak chips: Shorter, More casual, Stronger opening, End with a question.
- **Insert into LinkedIn** types the draft into the “Start a post” box (opening LinkedIn first if you're elsewhere) and also copies it. **It never presses Post.** If LinkedIn's page changes and the box can't be found, you get the copy and a Ctrl+V hint. It never overwrites text already in the box.
- Your notes and drafts are kept if you close the panel.

## 7. Tailor your resume for a job

First upload your **.tex** in your profile (👤). Then open a job page (or pick a saved role, or paste a description) → **Tailor** tab → **Check my resume for this job**.

- **Match score** — which skills and tools the job asks for, weighted (things under "Requirements" count more than "Nice to have"; repeated mentions count more), compared with your resume. It is a guide, not a promise: real applicant-tracking systems differ.
- **Three honest lists.** *Already on your resume* · *On your profile, missing from your resume* (you list these yourself, so you can honestly add them; **Copy "add to Skills" line**) · *Not on your profile* (real gaps — Twigg never offers to add these).
- **Suggest bullet rewrites** — the AI may only *reword* bullets you already wrote, using the job's vocabulary. Each suggestion is checked in code and thrown away (shown unticked with the reason) if it adds a number, adds a tool the original bullet didn't mention, switches to first person, or balloons in length. You can edit any suggestion; its warning updates as you type.
- **Build tailored .tex** — only the bullets you ticked change; your preamble, headings, dates, skills and anything you commented out are left byte-for-byte as they were. Then **Download .tex** and upload it to Overleaf for the PDF. Always check the PDF before sending it.
- Works with Jake's Resume and similar templates (`\resumeItem{…}` and plain `\item` lines). A reworded bullet loses inline bold/links *inside that one bullet*.
- No .tex yet? It still scores your profile against the job; bullet rewrites need the .tex.

## 8. Outreach drafts

**Outreach** tab → pick the kind of message: *Referral request* (LinkedIn message), *Connection note* (300-character limit), *Cold email to a recruiter*, *Research internship email to a professor*, or *Follow-up* after applying.

- Optionally pick a **saved role** (the follow-up uses the real date you applied) and tick **Use this page** on the person's LinkedIn profile, faculty page or company page. Add a line about what you want.
- Twigg writes one draft. For emails it fills **To** *only* if the page itself shows an address (a `mailto:` link). **It never guesses an email address.**
- It's a draft, not a send: **Copy**, or **Open in Gmail** (a compose window with the subject and body; you add the recipient if blank and press Send).
- Every draft is checked in code and a yellow note lists what to fix before you send: leftover `[Name]`-style placeholders, a greeting name that isn't on the page or in your notes, generic flattery ("big fan"), claiming you *read their paper* when you didn't say so, a number or time span you never gave, a connection note over 300 characters, a missing subject. Small AI models make these mistakes often in cold messages, so read it and check every name before sending.
- Chips: Shorter, Warmer, More direct (the warnings are re-checked on the new text). Your draft survives closing the panel.

### Skill gaps

In the **Roles** tab, **Skill gaps** reads the skills that your saved roles (full postings, not just search-result stubs) keep asking for and shows how many roles mention each one:

- **Missing — not on your profile**: asked for often, but you list it nowhere. Don't claim it; learn or build something.
- **On your profile, not on your resume** (when a .tex is stored): you can honestly add these.
- **Already on your resume / profile.**
- **Suggest projects for my top gaps** (AI): small 1–2 week project ideas that build on your existing work, each with a phrase for how to show it once you've done it. These are things to *do*, never claims.

It needs at least 3 saved roles with enough detail to read skills from.

## Project layout

```
extension/
  manifest.json        MV3 manifest
  background.js        service worker (Alt+F, role saving, reminders)
  lib/                 llm.js (Gemini + Ollama), autofill.js, profile.js, resume-import.js, prompts.js, settings.js,
                       roles.js (parsing, filters, red flags), store.js (IndexedDB), page-roles.js, fit.js (AI rating), reminders.js,
                       post.js, tex.js + ats.js + tailor.js (resume tailoring), outreach.js, skillgap.js
  content/             page scripts: extract.js, adapters.js + detect.js (role collection), fieldmatch.js + fields.js (autofill), composer.js (LinkedIn post box)
  sidepanel/           the side panel: Chat, Fill, Roles (+ skill gaps), Tracker, Post, Tailor, Outreach
  editor/              profile & resume page
  options/             settings page
  ui/                  shared theme, markdown renderer, form editor
  vendor/pdfjs/        PDF reader (Apache-2.0)
  profile/profile.json blank starting template (your data lives in the browser, not here)
```

## Privacy and your API key

- Everything Twigg stores — your profile, resumes, saved roles, drafts and settings — lives in this browser (`chrome.storage` and IndexedDB). There is no Twigg server.
- **Your Gemini API key is stored only in your browser's extension storage.** It is never written to a file in this project, so it cannot end up in Git. Never paste a key into source code, issues or chat; if you ever do, delete it at <https://aistudio.google.com/apikey> and create a new one.
- Twigg never sends your phone number, email, address, date of birth or roll number to the AI (autofill fills those locally). The one exception is *resume import*, which has to send your resume text to the AI once so it can read it — use Ollama-only mode if that matters to you.
- It never submits a form, presses LinkedIn's Post button, sends an email, or ticks a consent box. You do the final click.

## Project status and limits

All seven planned phases are built. It was developed and tested in Brave against saved copies of real job pages and mock forms; most AI output was checked with a fake AI server and some with a small local model (`gemma3:4b`), so wording quality with Gemini is less tested. Not verified live: LinkedIn's real post box, signed-in LinkedIn pages, Internshala single-job pages, Lever/Workday/hackathon sites, and compiling the tailored `.tex` (checked structurally only — always check the PDF). The development test scripts are not part of this repository yet.

Bundled third-party code: [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0, `extension/vendor/pdfjs/`). No license has been chosen for Twigg's own code yet; add one (for example MIT) before accepting contributions.

For a full walkthrough of how it works (written for newcomers), read [PROJECT_GUIDE.md](PROJECT_GUIDE.md).

## Troubleshooting

| Problem | Fix |
|---|---|
| "Ollama refused the extension (403)" | Set `OLLAMA_ORIGINS` (above) and restart Ollama |
| "Could not reach Ollama" | Start the Ollama app |
| Gemini 429 | Free-tier rate limit: wait a minute or switch to Ollama |
| Resume PDF gives "couldn't read any text" | It's a scanned image — upload the .tex or type details in |
| "Twigg can't read this tab" | Browser pages (`chrome://`, Web Store, PDF viewer) can't be read |
| Brave: Test buttons fail with a network error | Lower Shields (lion icon) on the Twigg settings page |
| Roles tab empty on a job page | Press **Scan this page** (see section 5). Tabs opened before Twigg was (re)loaded need a scan or a refresh |
| Gemini says a model "is no longer available" | Reload the extension (an old version is running) and set the model to `gemini-3.5-flash` in settings |
