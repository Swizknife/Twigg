# Twigg — The Complete Project Guide (for freshers)

> A browser extension that helps an engineering student apply for internships faster and more honestly:
> it fills forms, collects and filters jobs, tracks applications, tailors the resume, and drafts LinkedIn posts and outreach messages.
> **Everything runs on your own laptop. The AI is free. Nothing is ever submitted or sent for you.**

**Who this is for:** someone new to this project (and maybe new to browser extensions). You do not need to know the code. Read top to bottom the first time; later, jump to what you need.

**Size of the project:** about 5,400 lines of plain JavaScript, plus HTML/CSS. No framework, no build step, no server.

---

## Table of contents

1. [What is Twigg, and why does it exist?](#1-what-is-twigg-and-why-does-it-exist)
2. [The features at a glance](#2-the-features-at-a-glance)
3. [Ideas you need first (a mini-course)](#3-ideas-you-need-first-a-mini-course)
4. [Setup: install it and give it your resume](#4-setup-install-it-and-give-it-your-resume)
5. [How to use each feature (step by step)](#5-how-to-use-each-feature-step-by-step)
6. [How it is built: the architecture](#6-how-it-is-built-the-architecture)
7. [Tech flow: what happens inside, feature by feature](#7-tech-flow-what-happens-inside-feature-by-feature)
8. [The AI layer, and why we do not trust it blindly](#8-the-ai-layer-and-why-we-do-not-trust-it-blindly)
9. [Where your data lives, and what the AI sees](#9-where-your-data-lives-and-what-the-ai-sees)
10. [Tech stack (in brief)](#10-tech-stack-in-brief)
11. [Design rules we never break](#11-design-rules-we-never-break)
12. [Folder and file map](#12-folder-and-file-map)
13. [How it was tested, and what is still unverified](#13-how-it-was-tested-and-what-is-still-unverified)
14. [Troubleshooting](#14-troubleshooting)
15. [How to extend it (worked examples)](#15-how-to-extend-it-worked-examples)
16. [Suggested reading order for the code](#16-suggested-reading-order-for-the-code)
17. [Glossary](#17-glossary)

---

## 1. What is Twigg, and why does it exist?

### The problem
Applying for internships as a student is slow and repetitive:

- You type the same name, email, CGPA, 10th/12th marks into dozens of forms.
- You open 50 job pages and can't remember which ones fit you or which deadlines are near.
- You don't know if your resume matches a job's keywords.
- Writing LinkedIn posts and cold emails takes time, and you stare at a blank page.
- You track applications in your head.

### The solution
**Twigg** lives in a **side panel** inside your browser (Brave, Chrome or Edge). It knows your resume, and it helps on whatever page you have open.

### What Twigg is NOT
| It is not... | Why that matters |
|---|---|
| An auto-apply bot | It **never clicks Submit** and never ticks consent boxes. You review and submit. Bots get accounts flagged and send wrong answers. |
| A cloud service | There is **no Twigg server**. Your data stays in your browser. |
| Paid | It uses the **free** Gemini API key and/or a free local model (Ollama). |
| An email sender / LinkedIn poster | It writes **drafts**. You read them, then press Send or Post yourself. |
| Always right | AI makes mistakes. Twigg adds **checks and warnings**, but you must read everything. |

---

## 2. The features at a glance

| # | Feature (tab) | One-line description |
|---|---|---|
| 1 | **Chat** | Ask questions about the page you are on ("Am I eligible?", "Summarize this role"). |
| 2 | **Profile / Resume** (👤 page) | Upload your resume PDF/.tex once; the AI reads it into editable details. Update any time. |
| 3 | **Fill** | Fills application forms from your profile. Colour-codes what it filled. Never submits. (Shortcut: Alt+F) |
| 4 | **Roles** | Automatically collects jobs/hackathons as you browse, filters them, scores fit, shows red flags. Also the **Skill gaps** report. |
| 5 | **Tracker** | Pipeline from Shortlisted → Applied → Test → Interview → Offer, with deadlines, follow-ups, reminders. |
| 6 | **Post** | Turns your rough notes (or a GitHub page) into 2 LinkedIn drafts; can type one into LinkedIn's post box. |
| 7 | **Tailor** | Scores your resume against a job, shows honest gaps, rewords bullets safely, exports a tailored `.tex`. |
| 8 | **Outreach** | Drafts referral messages, recruiter emails, professor emails, follow-ups. |

(The project was built in seven phases; the **Skill gaps** report lives inside the Roles tab, so it has no tab of its own.)

---

## 3. Ideas you need first (a mini-course)

If you already know browser extensions, skip to [Section 4](#4-setup-install-it-and-give-it-your-resume).

### 3.1 What is a browser extension?
A small program that runs inside your browser and can read/change web pages. It is just **HTML + CSS + JavaScript** files in a folder, described by one file called `manifest.json`.

### 3.2 Manifest V3 (MV3)
`manifest.json` is the extension's ID card. It lists:

- **name, version**
- **permissions** it needs (e.g. `storage` to save data, `alarms` for timers, `notifications`)
- **which files do what** (the background script, the side panel page, scripts to inject into websites)

Twigg uses **Manifest V3**, the current standard in Chrome-family browsers.

### 3.3 The three places code runs
This is the single most important idea in the project. Think of a restaurant:

| Place | Restaurant analogy | What it is in Twigg |
|---|---|---|
| **Extension pages** (side panel, profile editor, settings) | The dining room: where the customer (you) interacts | `sidepanel/`, `editor/`, `options/`. Most of the logic lives in `lib/*.js`, imported here. |
| **Service worker** (`background.js`) | The receptionist: wakes up only when called, handles messages and timers | Receives "I found a job" messages, sets the toolbar badge, sends reminder notifications, handles the Alt+F shortcut. It **sleeps** when idle, so it keeps no state in memory. |
| **Content scripts** (`content/*.js`) | A waiter standing inside the customer's room (the website): can see everything on the page, but speaks only through messages | Small scripts that run **inside the website tab**. They read the page (job info, form fields) and fill forms. |

They talk by **messages** (`chrome.runtime.sendMessage`) or by the extension **injecting** a script into a tab (`chrome.scripting.executeScript`).

> **Isolated world:** content scripts run in a sandbox. They can read the page's HTML but cannot see the page's own JavaScript variables, and the page cannot see theirs. That is a security feature.

### 3.4 Where an extension stores data
| Storage | Used for | Notes |
|---|---|---|
| `chrome.storage.local` | Settings, your profile, answers, resume files, filters, drafts | Key-value. Survives restarts. This browser only. |
| `chrome.storage.session` | "What roles are on this tab right now" | Cleared when the browser closes. |
| **IndexedDB** | The list of collected roles | A real in-browser database; good for many records. |

Nothing goes to the cloud. If you use another browser, you start empty (use **Export backup** in the profile page).

### 3.5 What is an LLM, a prompt, Gemini and Ollama?
- **LLM** (large language model): software that predicts text. You give it a **prompt** (instructions + data), it returns text.
- **Gemini**: Google's models. A **free API key** (from aistudio.google.com) lets you call it. Fast and smart, runs in Google's cloud.
- **Ollama**: a program that runs models **on your own computer**. Private and offline, but slower on a CPU-only laptop and less accurate with small models (we use `gemma3:4b`).

Twigg supports both, with automatic fallback (Gemini first, Ollama if Gemini fails).

### 3.6 Other terms used later
- **JSON-LD / JobPosting**: many job sites embed a hidden, structured description of the job in the page (`<script type="application/ld+json">`). Reading that is more reliable than scraping the visible layout.
- **ATS (Applicant Tracking System)**: software companies use to filter resumes, often by keyword matching.
- **LaTeX / `.tex` / Overleaf**: a document language many students use for resumes. Overleaf is the website that compiles `.tex` into a PDF.
- **DOM**: the page's structure in memory (the tree of HTML elements). Scripts read and change it.
- **Service worker idle shutdown**: MV3 background code is stopped after ~30 s of inactivity, so it must not rely on variables staying alive.

---

## 4. Setup: install it and give it your resume

### Step 1 — Load the extension (2 minutes)
1. Open `brave://extensions` (Chrome: `chrome://extensions`, Edge: `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the `Twigg/extension` folder.
4. Pin Twigg to the toolbar. Click its icon (or press **Alt+T**) to open the side panel.
5. After you change any code, press the **↻ reload** button on Twigg's card.

### Step 2 — Give it an AI (pick one or both)

**Option A: Gemini (recommended, free, smarter)**
1. Go to <https://aistudio.google.com/apikey>, create a key (newer keys start with `AQ.`, older ones with `AIza`).
2. Twigg Settings (⚙) → paste the key → **Load models** → pick a *flash* model → **Test Gemini**.
3. Keep your key private. Never paste it in chats or code.

**Option B: Ollama (private, local)**
1. Install Ollama and run `ollama pull gemma3:4b`.
2. Browsers are blocked by Ollama by default. Run **once** in PowerShell, then restart Ollama from the tray:
   ```powershell
   setx OLLAMA_ORIGINS "chrome-extension://*"
   ```
3. Settings → **Test Ollama**.

> Gemini's free tier may use prompts to improve Google products. Use **Ollama only (private mode)** for sensitive things. Twigg never sends your phone, email, address or date of birth in chat/autofill/scoring (see [Section 9](#9-where-your-data-lives-and-what-the-ai-sees)).

### Step 3 — Add your resume(s) (and update them any time)
Click 👤 in the side panel. You can keep **one resume per target role** (up to 4).

1. On the first resume card, type the role it is for (e.g. "AI Engineering").
2. **Upload PDF** (used for "Attach resume" fields) and **Upload .tex** (used for tailoring).
3. Twigg **reads each file as soon as you upload it** and fills in what that resume shows, plus your shared details. Everything it filled is **highlighted**. Check it and press **Save** — nothing is saved before that.
4. **+ Add another resume** for your second role and repeat.
5. In **About you** (shared by all resumes) fill what a resume doesn't contain: date of birth, 10th/12th marks, address, preferences. Leave empty what doesn't apply — Twigg never guesses it.
6. Add 2–3 of your own LinkedIn posts under "Your writing style".
7. When a resume changes, upload the new file on its card.

You are ready.

---

## 5. How to use each feature (step by step)

### 5.1 Chat about a page
1. Open a job/internship page.
2. Side panel → **Chat**.
3. Tap a quick button (*Summarize this role*, *Am I eligible?*, *Skills I am missing*, *Prep questions*) or type your own question.
4. Untick **Use page** if you want a general question.

### 5.2 Autofill an application form
1. Open the application form.
2. **Fill** tab → **Fill this page** (or press **Alt+F**).
3. Look at the colours on the page:
   - 🟢 **Green** — filled from your profile.
   - 🟡 **Yellow** — check it (AI-written, converted value, guessed date format).
   - 🔴 **Red** — needs you (required field Twigg couldn't answer).
   - No colour — already had text, or an optional field was left empty.
4. Click an item in the panel's "Needs your eye" list to jump to that field.
5. Fix red/yellow fields yourself, **tick consent boxes yourself**, then submit yourself.
6. If the form has a resume upload and you keep several resumes, Twigg **asks which one**: pick it under *"Which resume should I attach?"* and press **Attach**. (With a single resume it is attached directly.)
7. Optional: **Remember my answers…** saves what you typed so Twigg reuses it next time.
7. Multi-page forms (e.g. Workday): click Next yourself, then Fill again.

### 5.3 Collect and filter roles (just browse)
1. Browse job pages and search results (Internshala, Naukri, Indeed, Unstop, LinkedIn, company career pages).
2. Twigg quietly saves what it sees. The toolbar badge shows the number of matches (`!` means you already applied to it).
3. **Roles** tab: views are **Matches / Maybe / ★ / Hackathons / Skipped / Ignored / All**.
4. **Filters**: keywords, words to skip, minimum stipend, max duration, locations, remote-only, your graduation year. Saving re-checks every saved role.
5. On a card: **☆ Shortlist** (gets deadline reminders), **Applied** (moves to Tracker), **Rate fit** (AI score), **Ignore**, **Delete**.
6. **Rate fit for matches** rates a few at a time (kind to the free quota).
7. **Export CSV** gives a spreadsheet.

### 5.4 Track applications
**Tracker** tab: change a role's status, set deadline/follow-up dates, add notes. "Coming up" shows what is due. You get a browser notification once per deadline (shortlisted roles) and once per follow-up.

### 5.5 Skill-gap report
**Roles** tab → **Skill gaps**. Shows which skills your saved roles keep asking for:
- *Missing — not on your profile* (don't claim it; learn it).
- *On your profile, not on your resume* (you can honestly add it).
- *Already on your resume.*
Click **Suggest projects for my top gaps** for small project ideas (things to do, not claims). Needs ≥ 3 saved roles with full descriptions.

### 5.6 Write a LinkedIn post
1. **Post** tab → choose the type (project launch, joined internship, certificate, hackathon, learning milestone, research, other).
2. Type rough notes. (Optional: open your GitHub repo page and tick **Also use this page**.)
3. **Write 2 drafts**. Read them. A yellow note lists anything not in your notes (numbers, time spans, plans).
4. Edit freely, use tweak chips (*Shorter, More casual, Stronger opening, End with a question*).
5. **Insert into LinkedIn** puts the draft into the post box (and copies it). **You** press Post.

### 5.7 Tailor your resume to a job
1. Upload your `.tex` in 👤 first.
2. Open the job page (or pick a saved role, or paste a description) → **Tailor** → **Check my resume for this job**.
3. Read the score and the three lists: on your resume / on your profile but missing / real gaps.
4. **Suggest bullet rewrites**. Untick any you dislike; edit others; warnings update as you type.
5. **Build tailored .tex** → **Download .tex** → upload to Overleaf → check the PDF.

### 5.8 Draft outreach
1. **Outreach** tab → choose the message type.
2. (Optional) choose a saved role; open the person's LinkedIn/faculty page and tick **Use this page**.
3. Type what you want in a line or two → **Write draft**.
4. Read the yellow warnings (placeholders, invented names, flattery, etc.). Fix them.
5. **Copy**, or **Open in Gmail**, then send it yourself.

---

## 6. How it is built: the architecture

### 6.1 The big picture

```
┌───────────────────────── Your browser (Brave / Chrome / Edge) ─────────────────────────┐
│                                                                                         │
│  Website tab (e.g. Internshala)            Twigg side panel / profile page / settings   │
│  ┌───────────────────────────────┐         ┌────────────────────────────────────────┐   │
│  │ Content scripts (inside page) │         │  sidepanel/*.js  editor/*.js  options/ │   │
│  │  • detect.js + adapters.js    │         │         │ import                       │   │
│  │  • extract.js                 │         │         ▼                              │   │
│  │  • fieldmatch.js + fields.js  │         │  lib/*.js  (the real logic)            │   │
│  │  • composer.js                │         │   llm · profile · roles · store · ats  │   │
│  └──────────────┬────────────────┘         │   tex · tailor · post · outreach · …   │   │
│                 │ messages                 └───────────────┬────────────────────────┘   │
│                 ▼                                          │                            │
│  ┌──────────────────────────────┐                          │ fetch()                    │
│  │ background.js (service worker)│◄─ alarms, Alt+F ────────┤                            │
│  │  badge · reminders · saving   │                          ▼                            │
│  └───────────────┬───────────────┘            ┌──────────────────────────┐              │
│                  │                            │  AI: Gemini (cloud, free) │              │
│                  ▼                            │   or Ollama (your laptop) │              │
│   chrome.storage.local / .session             └──────────────────────────┘              │
│   IndexedDB ("twigg" → "roles")                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Layers, from the bottom up
1. **Browser APIs** — storage, tabs, scripting, alarms, notifications, side panel.
2. **`lib/` (core logic)** — plain functions that don't touch the screen. Easy to test. Examples: `roles.js` parses stipends and judges roles; `ats.js` finds keywords; `tex.js` edits LaTeX.
3. **`content/` (page-side scripts)** — read/modify websites.
4. **`background.js`** — glue and timers.
5. **`sidepanel/`, `editor/`, `options/`, `ui/`** — what you see and click.

> **Why separate `lib/` from the screens?** If logic is pure (input → output), you can test it in Node without a browser, reuse it in the service worker *and* the side panel, and read it without UI noise.

### 6.3 Why "plain JavaScript, no build step"?
- You load the folder and it works. No `npm install`, no bundler errors.
- Easier for a student to read and tweak.
- Trade-off: no TypeScript type safety, and no React. For this size, that was the right trade.

### 6.4 The messages that connect the pieces
| Message / call | From → To | Purpose |
|---|---|---|
| `{type:'twigg-roles', roles, page}` | content script → service worker | "I found these jobs on this page" |
| `{type:'twigg-filled', tabId, result}` | service worker → side panel | Alt+F finished; show the result |
| `chrome.scripting.executeScript(...)` | side panel / worker → page | Run page code (autofill, read page text, insert LinkedIn post) |
| `chrome.storage.onChanged` | storage → every open UI | "Data changed, redraw" (e.g. `rolesVersion`) |

---

## 7. Tech flow: what happens inside, feature by feature

Each flow lists the steps and the files involved.

### 7.1 AI call (used by almost everything) — `lib/llm.js`
```
UI/feature → stream()/complete()/completeJSON()
   → reads settings (provider, keys)
   → tries Gemini (streamGenerateContent, SSE)  ── fails before any text? ──┐
   → falls back to Ollama (/api/chat, NDJSON)  ◄──────────────────────────┘
   → friendly errors with hints (403 → set OLLAMA_ORIGINS, 429 → rate limit…)
```

### 7.2 Resumes and resume import — `editor/editor.js`, `lib/resume-import.js`, `lib/profile.js`
```
Storage model:
   profile  = About you (basics, education, preferences) — the same on every resume
   resumes  = [{ id, label, pdf, tex, content }] — one per target role; content = skills, projects, experience…
   loadProfile().profile = About you + the UNION of all resumes (used by chat, autofill, fit, posts, outreach)

Upload PDF/.tex on a resume card
   → the file is stored on that resume right away (base64 for the PDF)
   → read immediately: pdf.js (vendored) extracts text AND hidden link targets (GitHub/LinkedIn URLs)
   → prompt asks the AI for strict JSON (no invention; "" if absent)
   → mergeImported(): that resume's content + your shared basics/education; form-only details you typed are kept
   → changed fields highlighted (tree-editor marks fields by data-path); saved only when you press Save
   → storage errors (e.g. a full disk) are shown as a plain message, never swallowed
Old single-resume data is migrated automatically into resume #1 ("My resume").
```

### 7.3 Autofill — `lib/autofill.js`, `content/fieldmatch.js`, `content/fields.js`
```
Fill (button or Alt+F)
 1. inject fieldmatch.js + fields.js into EVERY frame of the tab
 2. each frame: scan inputs/selects/radios/textareas
      label = aria-labelledby → <label for> → wrapping label → aria-label → text just above
 3. rules: classify(label) → profile key (e.g. "first name" → firstName)
      options (selects/radios) matched by whole words ("Male" never matches "Female")
      saved answers checked first; autocomplete="" attributes as a fallback
 4. set values the way React/Angular expect (native setter + input/change events)
 5. leftovers → ONE AI request (labels, options, your non-personal profile, job snippet)
 6. finalize: write AI answers, colour fields green/yellow/red
 7. resume upload fields: one resume → attach its PDF (DataTransfer); several → leave the field red and
    return a "resumeChoice" so the Fill tab asks which one (attachResume() runs after you pick)
 NEVER: click Submit/Next, tick checkboxes, touch passwords, overwrite existing text (unless asked)
```

### 7.4 Role collection — `content/detect.js`, `content/adapters.js`, `background.js`, `lib/roles.js`, `lib/store.js`
```
Page loads → detect.js (all pages) checks for job data already on the page:
   a) JSON-LD "JobPosting"   b) a known site's cards/detail layout (adapters.js)
 → sends raw role fields to background.js
background.js → ingest():
   normalizeRole()  → clean title/company/location, parse stipend/duration/deadline
   mergeRole()      → a list card never downgrades a full detail record; your status/notes survive
   evaluate()       → keywords + hard filters + red flags → verdict match | maybe | skip
   save to IndexedDB (if "Collect as I browse" is on)  +  chrome.storage.session for the panel
   set the toolbar badge
```
Role IDs are canonical (e.g. `linkedin:4459699809`), so the same job opened twice, or via a list *and* its own page, is **one** record.

### 7.5 Filters and red flags — `lib/roles.js` (`evaluate`)
- **Relevance:** whole-word keyword match in the title (so "ai" never matches "mail"); exclusion words (sales, marketing…).
- **Hard filters:** deadline passed, stipend below your minimum, unpaid, not remote, location not in your list, duration too long.
- **Eligibility hint:** batch/graduation years named in the posting vs yours.
- **Red flags:** asks you to pay a fee (auto-skip), apply via WhatsApp/Telegram, earn-from-home pitch, performance-only pay, unpaid, hidden company.

### 7.6 AI fit score — `lib/fit.js`
```
"Rate fit" → prompt = your profile (no personal contact data) + the posting
 → AI returns JSON {score 0-100, eligible yes|check|no, strengths, gaps, reason, confidence}
 → saved on the role. Runs ONLY when you click (protects the free quota).
```

### 7.7 Tracker and reminders — `sidepanel/roles-ui.js`, `lib/reminders.js`, `background.js`
```
Statuses: new → saved(shortlisted) → applied → oa → interview → offer / rejected / ignored
"Applied" sets appliedAt and a follow-up date 7 days later.
chrome.alarms fires every hour → checkReminders():
   shortlisted role with a deadline in ≤2 days  → notification (once)
   open application whose follow-up date has come → notification (once)
```
Only **shortlisted** roles get deadline alerts, so auto-collected pages don't spam you.

### 7.8 LinkedIn post — `lib/post.js`, `sidepanel/post-ui.js`, `content/composer.js`
```
Notes (+ optional page text) → styleNotes(): measure YOUR writing style locally
   (sentence length, emojis, British/American spelling…) — your actual posts are NOT sent
 → prompt: "write two posts separated by =====" (plain text, not JSON)
 → parseVariants() tolerates messy replies; cleanPost() fixes newlines/limit/link
 → unsupportedClaims(): warns about numbers, time spans, plans, "significantly" not in your notes
Insert → composer.js: find the box (or click "Start a post"), paste text, NEVER click Post,
         never overwrite an existing draft; fallback = clipboard
```

### 7.9 Resume tailoring — `lib/tex.js`, `lib/ats.js`, `lib/tailor.js`, `sidepanel/tailor-ui.js`
```
Job text → extractKeywords(): skills lexicon with aliases (TF Lite = TensorFlow Lite = TFLite),
           weighted (Requirements > Nice-to-have; repeated mentions count more)
 → scoreResume(): split into matched / addable (on profile, not resume) / gaps (nowhere)
 → suggestRewrites(): parse bullets from .tex (comment-safe), pick the most relevant,
       AI rewords them, then validateRewrite() REJECTS any that add a number or a tool the
       original bullet lacked, use first person, or balloon in length
 → buildTailoredTex(): replace ONLY accepted bullets by exact position; check braces balance
 Everything else in your .tex stays byte-for-byte identical.
```

### 7.10 Outreach — `lib/outreach.js`, `sidepanel/outreach-ui.js`
```
type + (role) + (page text) + notes → prompt (plain text; "Subject:" first line for emails)
 → parseOutreach() splits subject/body
 → outreachWarnings(): placeholders [Name], greeting name not on the page, flattery,
       "I read your paper" claims, invented numbers/time spans, 300-char DM limit, missing subject
 → Copy / Open in Gmail (compose link; never guesses the recipient)
```

### 7.11 Skill-gap report — `lib/skillgap.js`, `sidepanel/gap-ui.js`
```
For every usable saved role → extractKeywords() → count distinct skills across roles
 → compare with resume (.tex) or profile → rows: gap / addable / resume, with "N roles · P%"
 → optional AI: one small project idea per top gap (framed as to-do)
```

---

## 8. The AI layer, and why we do not trust it blindly

AI is **useful but unreliable**. We learned (by testing the real local model) that small models:

| Problem seen | What we do about it |
|---|---|
| Copy a JSON template back verbatim ("short label") | Ask for **plain text with a separator** for long writing; keep JSON only for short structured tasks. |
| Borrow content from sample text in the prompt (e.g. your old posts) | Never send raw samples; send **measured style traits** only. |
| Invent numbers, durations, plans ("spent the last few weeks") | **Deterministic checks** after generation that warn you. |
| Invent names / claim they read someone's paper | Code checks against the page and your notes. |
| Add a tool that wasn't in the original resume bullet | `validateRewrite()` rejects it before you ever see it as "OK". |

**Pattern to remember:** *constrain the prompt → check the output in code → show warnings → human decides.*

Other points:
- Prompts live in **one file** (`lib/prompts.js`) so tone and rules stay consistent.
- **Gemini is noticeably better** than the 4B local model for writing. Use it for posts, resume bullets and outreach if you are comfortable with the privacy trade-off.
- The AI is only **asked**; it never takes actions. Code does the actions (and the code never submits/sends).

---

## 9. Where your data lives, and what the AI sees

### Stored (this browser only)
| What | Where |
|---|---|
| Settings, API key | `chrome.storage.local` |
| "About you" profile, resumes (label, PDF, .tex, content), saved answers, writing samples | `chrome.storage.local` (`profile`, `resumes`, `answers`, `voice`) |
| Collected roles | IndexedDB (`twigg` → `roles`) |
| Drafts (post/outreach), filters | `chrome.storage.local` |
| "Roles on this tab" | `chrome.storage.session` |

### What leaves your laptop (only to the AI you chose)
| Action | Sent to the AI |
|---|---|
| Chat | Page text + your profile **without** contact details/DOB/roll no. |
| Autofill (AI step only) | Unanswered field labels/options + non-personal profile + a short job snippet |
| Resume import | **The full resume text, once**, because the AI must read it (this includes your email/phone if they are on the resume) |
| Rate fit | Non-personal profile + the posting |
| Post | Your notes, optional page text, a few hashtag topics, **style traits** (not your posts) |
| Tailor | Your resume **bullets** + the job's keywords (no contact lines) |
| Outreach | Your notes, optional page/role text, non-personal profile (name + public links) |
| Skill-gap ideas | Gap names + your project names/tech |

If that matters to you, choose **Ollama only (private mode)** — then nothing leaves the laptop.

Extra safety: page content is untrusted, so the UI is built with `textContent` (never `innerHTML` for page data).

---

## 10. Tech stack (in brief)

| Layer | Technology | Why |
|---|---|---|
| Language | **JavaScript (ES modules)** | Runs natively in the browser; no build step |
| UI | **HTML + CSS** (hand-written, light/dark theme with CSS variables) | Simple, no framework needed |
| Platform | **Chrome Extension Manifest V3**: service worker, content scripts, side panel, `scripting`, `alarms`, `notifications` | Works in Brave, Chrome and Edge |
| Storage | `chrome.storage.local/session`, **IndexedDB** | Local-only data |
| AI (cloud) | **Google Gemini API** (default `gemini-3.5-flash`, with automatic fallback to other flash models), REST + streaming (SSE) | Free tier, fast, long context |
| AI (local) | **Ollama** (default `gemma3:4b`), `/api/chat` streaming (NDJSON) | Private/offline fallback |
| PDF reading | **pdf.js 4.10.38** (vendored in `extension/vendor/pdfjs`) | Extract text + link targets from a resume PDF |
| Resume format | **LaTeX** (Jake's Resume-style templates), Overleaf for PDF | Common among students |
| Structured data | **schema.org JSON-LD** (JobPosting) | Reliable job data from many sites |
| Dev/test only | **Node 22**, **puppeteer-core**, pdf-lib, selfsigned | Drive a real Brave with the extension loaded; not needed to *use* Twigg |

No server, no database server, no framework, no runtime npm dependencies.

---

## 11. Design rules we never break

1. **Never submit / send / post for the user.** The human always does the final click.
2. **Never tick consent boxes.** They are legal choices.
3. **Never overwrite what the user typed** (autofill skips non-empty fields; LinkedIn insert refuses a non-empty box).
4. **Never invent facts.** Prompts forbid it, code checks it, the UI warns, and honest gap lists never offer to "add" a skill you don't have.
5. **Never guess personal data** (a missing DOB stays empty and red; email addresses are never guessed).
6. **Keep data local.** No Twigg server.
7. **Free to run.** No paid APIs without asking.
8. **Do nothing expensive automatically.** AI scoring/writing runs only when you click.
9. **Fail gracefully with a helpful message and a fallback** (e.g. clipboard if LinkedIn's box isn't found; Ollama if Gemini fails).

---

## 12. Folder and file map

```
Twigg/
├─ PROJECT_GUIDE.md          ← this file
├─ README.md                 ← quick start
└─ extension/                ← the thing you "Load unpacked"
   ├─ manifest.json          ID card: permissions, entry points, shortcuts
   ├─ background.js          service worker: badge, Alt+F, role saving, reminder alarms
   ├─ icons/                 toolbar icons
   ├─ profile/profile.json   blank starting template (your real data is in browser storage)
   ├─ vendor/pdfjs/          vendored PDF reader (Apache-2.0)
   ├─ ui/                    theme.css · markdown.js (safe AI-reply rendering) · tree-editor.js (generic form builder)
   ├─ options/               settings page (AI choice, keys, tests)
   ├─ editor/                profile & resume page (upload, AI import, edit, backup)
   ├─ sidepanel/             the main UI
   │   ├─ sidepanel.html/.css/.js   shell, tabs, Chat
   │   ├─ fill.js            Fill tab
   │   ├─ roles-ui.js        Roles + Tracker tabs
   │   ├─ gap-ui.js          Skill-gap card (in Roles)
   │   ├─ post-ui.js         Post tab
   │   ├─ tailor-ui.js       Tailor tab
   │   └─ outreach-ui.js     Outreach tab
   ├─ content/               scripts that run INSIDE web pages
   │   ├─ extract.js         readable page text + JSON-LD job data
   │   ├─ adapters.js        per-site readers (Internshala, LinkedIn, Naukri, Indeed, Unstop, Greenhouse, Lever, Workday, hackathons)
   │   ├─ detect.js          runs on every page; reports job-like pages to the worker
   │   ├─ fieldmatch.js      "what is this field asking for?" rules (pure text logic)
   │   ├─ fields.js          scan/fill/highlight forms, attach resume PDF
   │   └─ composer.js        types a draft into LinkedIn's post box
   └─ lib/                   core logic (no screens)
       ├─ llm.js             Gemini + Ollama client, streaming, fallback, JSON helper
       ├─ prompts.js         every prompt in one place
       ├─ settings.js        user settings
       ├─ profile.js         load/save profile; flatten for forms; what the AI may see; merge imported resume
       ├─ resume-import.js   PDF text + link extraction → AI → profile fields
       ├─ autofill.js        orchestrates a fill across all frames
       ├─ roles.js           parsing, filters, red flags, merging, CSV (pure functions)
       ├─ store.js           IndexedDB wrapper + ingest pipeline
       ├─ fit.js             AI fit scoring
       ├─ reminders.js       deadline/follow-up notifications
       ├─ post.js            LinkedIn post logic + checks
       ├─ tex.js             LaTeX bullet parsing/editing
       ├─ ats.js             skills lexicon, keyword extraction, resume scoring
       ├─ tailor.js          rewrite suggestions + validation + .tex export
       ├─ outreach.js        outreach drafts + checks + Gmail link
       └─ skillgap.js        skill-gap report + project ideas
```

---

## 13. How it was tested, and what is still unverified

### How it was tested
- **Unit tests (Node):** pure logic — field matching (51 label cases), stipend/duration/deadline parsing, filters and red flags, LaTeX parsing/editing, keyword scoring, rewrite validation, post/outreach checks, skill-gap math.
- **Browser tests:** a real **Brave** with the extension loaded (driven by puppeteer-core), against
  - saved snapshots of **real pages** (Naukri, Indeed, Unstop, Greenhouse, a GitHub repo),
  - reconstructed pages where the real one needs a login (LinkedIn, Internshala),
  - mock forms (including iframes and a Google-Forms-style layout),
  - a **fake AI server** (so tests are fast, free and repeatable).
- About **190 browser checks** and many unit checks, all passing at the end of development.
- Real-model runs were done for autofill, resume import, fit scoring and posts. Those found real problems (see [Section 8](#8-the-ai-layer-and-why-we-do-not-trust-it-blindly)), which were fixed.

> **Note for a new contributor:** the test scripts were written in a scratch folder during development and are **not yet in the repository**. Adding a `tests/` folder is a good first task.

### Not verified (be honest with yourself)
| Area | Status |
|---|---|
| LinkedIn's real post box | Only tested on a mock box. Needs a login to test. Clipboard fallback exists. |
| LinkedIn signed-in pages | Selectors are best-effort guesses. |
| Internshala single-job pages | Reader written from memory (site returned errors during checks); list cards were observed live. |
| Lever, Workday, hackathon sites (Devfolio, Kaggle, MLH) | Best-effort, not tested live. |
| Google Forms, Workday forms | Tested only on mock structures. |
| `.tex` output compiling | No LaTeX on the dev machine; verified structurally (balanced braces, only chosen lines changed). **Always check the PDF.** |
| AI quality with real Gemini | Mostly tested with the small local model; Gemini should be better. |

Websites change their layout without notice. When a site breaks, the fix is usually one small edit in `content/adapters.js`.

---

## 14. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Ollama refused the extension (403)" | Ollama blocks extensions by default | `setx OLLAMA_ORIGINS "chrome-extension://*"`, then restart Ollama |
| "Could not reach Ollama" | Ollama isn't running | Start the Ollama app |
| Gemini error 429 | Free-tier rate limit | Wait a minute, or switch to Ollama |
| Gemini "invalid key" | Wrong/old key | Create a new key at aistudio.google.com/apikey (newer keys start with `AQ.`, older with `AIza`) |
| "Twigg can't read this tab" | Browser pages (`chrome://`, store pages, PDF viewer) can't be read | Use a normal website tab |
| Side panel doesn't open (older Brave) | `chrome.sidePanel` API missing | Twigg falls back to opening itself as a tab |
| Test buttons fail in Brave with a network error | Brave Shields | Lower Shields on the settings page |
| Autofill leaves a field red | No profile value or no matching option | Fill it yourself; use **Remember my answers** |
| Roles not being collected | "Collect roles as I browse" is off, or that site's layout changed | Turn it on; report the page so its reader can be updated |
| Code changes don't show | Extension wasn't reloaded | `brave://extensions` → ↻ on Twigg, then reopen the panel |
| Ollama "out of memory" with plenty of RAM | **Disk is nearly full**, so Windows can't grow the page file | Free disk space (and restart Windows) |
| Resume PDF "couldn't read any text" | Scanned image PDF | Upload the `.tex` or type details in |

---

## 15. How to extend it (worked examples)

### 15.1 Add a new job site reader
In `content/adapters.js`:
1. Write an object with `list()` (many roles from a search page) and/or `detail()` (one role). Each returns plain fields: `title, company, location, stipend, duration, deadline, skills, description, url, isDetail`.
   ```js
   const examplejobs = {
     list() {
       return [...document.querySelectorAll('.job-card')].map((card) => ({
         title: text(card, '.title'),
         company: text(card, '.company'),
         location: text(card, '.loc'),
         url: abs(card.querySelector('a').getAttribute('href')),
         isDetail: false,
       }));
     },
   };
   ```
2. Register it in `forPage()`: `if (/(^|\.)examplejobs\.com$/.test(host)) return examplejobs;`
3. Add the site's ID rule to `canonicalKey()` in `lib/roles.js` if it has stable job IDs.
4. Test by saving the page's HTML (scripts removed) as a fixture and checking the fields.

### 15.2 Teach autofill a new field (e.g. "LeetCode profile")
1. Add the value to the profile template (`profile/profile.json`) and to `flattenProfile()` in `lib/profile.js` (e.g. `leetcode: b.leetcode`).
2. Add a rule in `classify()` in `content/fieldmatch.js`: `if (has(/\bleetcode\b/)) return 'leetcode';`
3. Add a test label in the matcher's tests.
(The profile editor shows the new field automatically — it builds its form from the data's shape.)

### 15.3 Add a LinkedIn post type
Add an object to `POST_TYPES` in `lib/post.js` (`id, label, hint, placeholder`). It appears in the dropdown automatically.

### 15.4 Add an outreach message type
Add an entry to `OUTREACH_TYPES` in `lib/outreach.js` (`email: true/false`, `words`, `hint`, `placeholder`). If it needs special rules, add them in `outreachPrompt()` in `lib/prompts.js`.

### 15.5 Add a skill to the keyword lexicon
Add `['Display Name', ['alias one', 'alias two']]` to `LEXICON` in `lib/ats.js`. It affects scoring, tailoring and skill gaps at once.

### 15.6 Change default filters
Edit `DEFAULT_KEYWORDS` / `DEFAULT_EXCLUDE` in `lib/roles.js` (users can also change them in the Roles → Filters panel).

### Practice tasks for a fresher
1. Add a new post type "Open-source contribution".
2. Add ten new skills to the lexicon (e.g. `LangChain`, `OpenCL`).
3. Write a reader for a job site you use.
4. Add a `tests/` folder and move the unit tests into it.

---

## 16. Suggested reading order for the code

1. `extension/manifest.json` — the ID card; see what exists.
2. `extension/background.js` — short; the service worker.
3. `lib/llm.js` — how AI calls work (the most reused file).
4. `lib/prompts.js` — read the prompts to see the rules we give the AI.
5. `lib/roles.js` — clean, pure functions; good to read with the tests in mind.
6. `content/detect.js` + `content/adapters.js` — how pages are read.
7. `lib/store.js` — IndexedDB and the "ingest" pipeline.
8. `content/fieldmatch.js` → `content/fields.js` → `lib/autofill.js` — the autofill chain.
9. `lib/post.js`, `lib/tailor.js`, `lib/outreach.js` — AI features and their safety checks.
10. `sidepanel/sidepanel.js` and one `*-ui.js` file — how screens call the logic.

---

## 17. Glossary

| Term | Meaning |
|---|---|
| **Adapter** | A small per-website reader that knows that site's page layout |
| **ATS** | Applicant Tracking System; software that filters resumes, often by keywords |
| **Content script** | Extension code that runs inside a web page |
| **DOM** | The page's element tree in memory |
| **Fixture** | A saved sample page/data used for testing |
| **Guardrail** | A code check that limits or flags what the AI produced |
| **IndexedDB** | A database built into the browser |
| **JSON-LD** | Structured data hidden in a page (used for JobPosting) |
| **LLM** | Large language model (Gemini, gemma…) |
| **Manifest V3** | The current extension format |
| **Message passing** | How extension parts talk (`chrome.runtime.sendMessage`) |
| **Ollama** | Program that runs AI models locally |
| **Overleaf** | Website that compiles LaTeX into a PDF |
| **Prompt** | Instructions + data given to an LLM |
| **Service worker** | Background script that wakes on events and sleeps when idle |
| **Side panel** | The browser sidebar where Twigg's UI lives |
| **Stub** | A tiny fake server/function used in tests |
| **Verdict** | Match / Maybe / Skip: Twigg's quick judgement of a role against your filters |

---

*Twigg is a personal job-hunt assistant. It saves time, but you are still the one applying: read every draft, check every field, and send everything yourself.*
