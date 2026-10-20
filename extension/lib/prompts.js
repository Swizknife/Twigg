// Prompt templates. Every feature's prompt lives here so tone and rules stay consistent.

export function chatSystem({ profile, page }) {
  const sections = [
    `You are Twigg, a job-hunt copilot inside the browser of an engineering student.
You help them understand job/internship pages, judge fit and eligibility, prepare, and decide quickly.

Rules:
- Ground every factual claim about the role/company in the CURRENT PAGE. If the page does not say it, say "The page doesn't mention this" — never invent deadlines, stipends, eligibility, or company facts.
- When judging fit or eligibility, quote the exact requirement from the page and compare it with the STUDENT PROFILE.
- Be direct and concise. Prefer short bullet lists. No filler.
- If asked to write something (answer, email, message), write it in first person as the student, using only true facts from the profile.`,
    `STUDENT PROFILE (JSON):\n${JSON.stringify(profile)}`,
  ];

  if (page) {
    sections.push(
      [
        'CURRENT PAGE',
        `Title: ${page.title}`,
        `URL: ${page.url}`,
        page.selection && `Text the student selected:\n"""${page.selection}"""`,
        `Page content:\n"""${page.text}"""`,
      ]
        .filter(Boolean)
        .join('\n')
    );
  } else {
    sections.push('No page is attached to this question. Answer from general knowledge and the profile.');
  }
  return sections.join('\n\n');
}

const RESUME_SCHEMA = {
  basics: { name: '', headline: '', email: '', phone: '', linkedin: '', github: '', portfolio: '', currentCity: '' },
  education: [{ institution: '', degree: '', branch: '', startYear: '', graduationYear: '', cgpa: '', cgpaScale: '' }],
  skills: { programming: [], ml_dl: [], edge_ai: [], embedded_hardware: [], tools: [] },
  projects: [{ name: '', link: '', tech: [], bullets: [] }],
  experience: [{ company: '', role: '', start: '', end: '', location: '', bullets: [] }],
  achievements: [],
  certifications: [],
};

export function resumeImportPrompt(resumeText) {
  return {
    system: `You extract structured data from a resume. Output ONLY JSON in exactly this shape:
${JSON.stringify(RESUME_SCHEMA)}

Rules:
- Copy facts exactly as written. NEVER invent or infer anything. If something is not in the resume use "" (or [] for lists).
- headline: only if the resume has its own title/summary line, otherwise "".
- URLs must be full links (use the "Links embedded in the document" list to find them, e.g. match GitHub/LinkedIn).
- cgpa: just the number (e.g. "8.7"); cgpaScale: "10" or "4" only if the resume states it.
- skills: sort each skill into the closest category: programming languages → programming; ML/DL/CV/NLP frameworks and concepts → ml_dl; on-device/edge AI (TFLite, ONNX, TensorRT, quantization…) → edge_ai; microcontrollers, boards, hardware, communication protocols → embedded_hardware; everything else → tools.
- bullets: keep each bullet as one string, original wording.
- Include every project and every experience entry. Keep the order from the resume.`,
    user: `RESUME TEXT:\n"""${resumeText}"""`,
  };
}

/** Fields the profile couldn't answer, sent to the AI. `fields` carry global ids ("frameId:id"). */
export function fillPrompt({ profile, answers, fields, page }) {
  const saved = answers.filter((a) => a.question && a.answer).map((a) => ({ question: a.question, answer: a.answer }));
  return {
    system: `You fill in a job/internship application form for a student. Output ONLY JSON: {"fills":[{"id":"...","value":"..."}]}

Hard rules:
- Use ONLY facts from STUDENT PROFILE and SAVED ANSWERS. If a field cannot be answered truthfully from them, OMIT it. A blank field is better than a wrong one.
- Never guess: dates, ID numbers, scores, yes/no on legal status, work authorization, visa, disability, ethnicity, criminal record, salary/stipend figures, or anything personal that is not given.
- select/radio fields: "value" must be copied EXACTLY from that field's options. If no option fits, omit the field.
- type "textarea" fields (open questions like "Why do you want to join us?"): write a direct first-person answer of 50-110 words, grounded in the profile and the job posting. Reuse a relevant SAVED ANSWER when one fits, adapting it to this company. No buzzwords, no flattery, no emoji. Respect maxLength if given.
- Short text fields: give just the value, no sentences.`,
    user: `JOB PAGE: ${page.title} (${page.url})\n"""${page.text}"""\n\nSTUDENT PROFILE:\n${JSON.stringify(profile)}\n\nSAVED ANSWERS:\n${JSON.stringify(saved)}\n\nFIELDS TO FILL:\n${JSON.stringify(fields)}`,
  };
}

export function fitPrompt({ profile, role }) {
  const posting = {
    title: role.title,
    company: role.company,
    location: role.location,
    remote: role.remote,
    stipend: role.stipend?.text,
    duration: role.durationText,
    deadline: role.deadline,
    skills: role.skills,
    description: (role.description || '').slice(0, 4500),
  };
  const thin = (role.description || '').length < 300;
  return {
    system: `You judge how well an internship/job fits a student. Output ONLY JSON:
{"score": 0-100, "eligible": "yes"|"check"|"no", "strengths": [up to 3 short strings], "gaps": [up to 3 short strings], "reason": "one sentence", "confidence": "high"|"low"}

Rules:
- Use ONLY facts in STUDENT PROFILE. Never assume skills or experience they didn't list.
- Score: 80-100 most must-haves present and eligible; 60-79 good fit with a few gaps; 40-59 partial; under 40 weak or off-target.
- "eligible": "no" only if the posting clearly excludes them (graduation year, branch, degree, location); "check" if it is unclear or mentions requirements you can't verify.
- strengths/gaps must name concrete things from the posting vs the profile (e.g. "Posting wants ONNX; profile lists TFLite only").
- ${thin ? 'The posting text is very short: judge mostly from the title and skills, keep the score moderate, and set confidence "low".' : 'Set confidence "high" when the posting is detailed.'}`,
    user: `STUDENT PROFILE:\n${JSON.stringify(profile)}\n\nPOSTING:\n${JSON.stringify(posting)}`,
  };
}

const LENGTHS = { short: '60-90 words', medium: '120-180 words', long: '200-280 words' };
const TONES = {
  plain: 'plain, sincere and specific — how a thoughtful student would actually talk',
  professional: 'polished and professional, but still human',
  casual: 'relaxed and conversational, light humour allowed',
};

export const POST_SEPARATOR = '=====';

/**
 * Two LinkedIn post drafts from the student's own notes (and optionally a project/certificate page).
 * Plain text with a separator line, not JSON: small local models copy a JSON template back verbatim.
 * `style` is a short list of style traits measured from the student's own posts — never the posts themselves,
 * because small models borrow the subject matter of any sample text they are shown.
 */
export function postPrompt({ type, notes, page, style = [], profile, tone, length, link }) {
  return {
    system: `You write LinkedIn posts for an engineering student, in their own voice.

Write TWO different posts about the SAME thing. Put a line containing only ${POST_SEPARATOR} between them. Output nothing else: no titles, no labels, no commentary.
- Post 1 starts with the story or the problem. Post 2 starts with the result or the main takeaway.

Hard rules:
- First person, as the student. EVERY fact in a post must come from WHAT THE STUDENT SAID or the PAGE. Do not add events, steps, results, plans, feelings, numbers, names, companies or dates that are not stated there. Do not say how long something took, or what will happen next, unless it is stated. Do not call things "significant" or "considerable" unless the student did.
- Never mention "the notes", "the page" or these instructions inside a post. Write it as if the student is simply telling their own story.
- HASHTAG IDEAS are only for the final hashtag line. Never mention them in the post text unless the student said it.
- Structure: a first line that makes someone want to read on (under 140 characters, concrete, no hype); short paragraphs of 1-2 sentences separated by blank lines; one specific detail from the notes; what was learned, using the notes' own point; optionally end with a genuine question.
- Length of each post: ${LENGTHS[length] || LENGTHS.medium}. Tone: ${TONES[tone] || TONES.plain}.
${style.length ? `- Match the student's writing style: ${style.join(' ')}\n` : ''}- Never use: "thrilled", "excited to announce", "delighted", "humbled", "game-changer", "passionate about", "I'm happy to share", "blown my mind", "wild", "journey" (as a cliché), "leverage", "synergy".
- At most 1 emoji in total (zero is best). Few exclamation marks. No bullet-point lists.
- The last line of each post: 3-5 relevant hashtags.
${link ? `- Include this link once, near the end (not in the first line): ${link}` : '- Do not invent any link.'}
- Post type: ${type.label}. ${type.hint}`,
    user: [
      `WHAT THE STUDENT SAID (their own words — the only source of facts):\n"""${notes || '(nothing — rely on the page below)'}"""`,
      page ? `PAGE (${page.title}, ${page.url}):\n"""${page.text}"""` : '',
      `HASHTAG IDEAS (topics the student works with — use for the hashtag line only, never in the post text):\n${JSON.stringify(profile)}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}

const OUTREACH_TONES = {
  warm: 'warm, respectful and direct — a polite student who respects their time',
  formal: 'formal and professional',
  casual: 'friendly and relaxed, still respectful',
};

/** A short cold message (referral DM, recruiter email, professor email, follow-up). Plain text, not JSON. */
export function outreachPrompt({ type, notes, page, role, profile, tone, link, appliedOn }) {
  const subjectLine = type.email ? 'The FIRST line must be "Subject: " followed by a specific subject (under 70 characters). Then a blank line, then the message.' : 'Output only the message text. No subject line.';
  return {
    system: `You write short outreach messages for an engineering student who is looking for an internship. ${subjectLine} Output nothing else: no labels, no commentary, no quotation marks around the message.

Hard rules:
- Write as the student, first person. Facts about the student come ONLY from STUDENT PROFILE and WHAT THE STUDENT SAID. Pick at most 1-2 profile items that are most relevant to this person or role; do not list everything.
- Facts about the recipient or company come ONLY from RECIPIENT PAGE or ROLE. Never invent their papers, projects, achievements, job title, team or company news. If the page does not say it, do not mention it.
- Never claim the student read, used or followed the recipient's work unless WHAT THE STUDENT SAID says so. Instead, "I'm interested in <topic from the page>" is fine.
- No generic flattery ("big fan", "love your work", "inspiring"). Be specific or say nothing.
- Do not invent numbers, dates, durations, results or plans. Do not promise anything.
- ONE clear, easy-to-answer ask. Make it easy to say no.
- Never use placeholders in brackets like [Name] or [Company]. If the recipient's name is not on the page, greet without a name ("Hi," or "Hello," or "Dear Hiring Team,"). Do not guess names or email addresses.
- Sign off with just the student's name (from STUDENT PROFILE).
- No emojis. Length: ${type.words} words. Tone: ${OUTREACH_TONES[tone] || OUTREACH_TONES.warm}.
${link ? `- You may include this link once: ${link}` : ''}
- Message type: ${type.label}. ${type.hint}${appliedOn ? `\n- The student applied on ${appliedOn}. Say so plainly.` : ''}`,
    user: [
      `WHAT THE STUDENT SAID (their own words):\n"""${notes || '(nothing extra)'}"""`,
      role ? `ROLE:\n${JSON.stringify({ title: role.title, company: role.company, location: role.location, skills: role.skills, description: (role.description || '').slice(0, 1800) })}` : '',
      page ? `RECIPIENT PAGE (${page.title}, ${page.url}):\n"""${page.text}"""` : '',
      `STUDENT PROFILE:\n${JSON.stringify(profile)}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}

export function outreachRefinePrompt({ text, instruction, email }) {
  return {
    system: `You edit a short outreach message. Apply the instruction and return ONLY the revised message${email ? ', keeping the "Subject:" first line' : ''} (no commentary, no quotes).
Keep every fact exactly as is. Do not add numbers, names, claims, flattery or placeholders in brackets.`,
    user: `INSTRUCTION: ${instruction}\n\nMESSAGE:\n"""${text}"""`,
  };
}

/** Small, realistic projects that would close a skill gap — suggestions only, never claims. */
export function gapProjectsPrompt({ gaps, projects, target }) {
  return {
    system: `You suggest small projects an engineering student could build to learn a skill that internship postings keep asking for.
For each gap give ONE project idea on its own line in this format:
<gap> — <what to build, in one sentence> | <how to show it on a resume, in one short phrase>
Rules: doable in 1-2 weeks on a laptop or a cheap board; build on the student's existing projects where possible; be concrete (name the model, dataset or board); no more than the gaps given; no introduction, no numbering, no closing remarks. These are suggestions to do — never write them as if already done.`,
    user: `TARGET ROLES: ${target || 'AI / edge AI internships'}\n\nSKILL GAPS (most requested first): ${gaps.join(', ')}\n\nSTUDENT'S EXISTING PROJECTS:\n${JSON.stringify(projects)}`,
  };
}

/** Reword resume bullets for one job without changing a single fact. */
export function tailorPrompt({ bullets, keywords, job }) {
  const list = keywords.slice(0, 14).map((k) => k.term).join(', ');
  return {
    system: `You reword resume bullet points so they use the wording of a specific job, WITHOUT changing any fact. Output ONLY JSON with this shape: an object with one key "rewrites" whose value is a list of objects, each having a numeric "id" and a string "text".

Rules:
- Reword a bullet only if it can honestly be improved. If it is already good, or you cannot improve it without adding facts, leave it OUT of the list.
- Keep every fact, number, tool and result exactly as in the original. Do NOT add any tool, technology, number, result, scale or responsibility that the original bullet does not already state.
- You may use a job keyword ONLY where the original bullet already describes that concept (for example, use the job's word "quantization" for a bullet that says "reduced precision to int8").
- Start with a strong past-tense verb. No first person (no I, my, we). No bullet symbols, no markdown, no quotation marks.
- Keep the length within about 20% of the original, one sentence.`,
    user: `JOB: ${job?.title || ''}${job?.company ? ` at ${job.company}` : ''}\nKEYWORDS THE JOB ASKS FOR: ${list}\n\nBULLETS (id, section, text):\n${bullets.map((b) => `${b.id} | ${(b.context || '-').replace(/\|/g, '/')} | ${b.plain}`).join('\n')}`,
  };
}

export function refinePrompt({ text, instruction }) {
  return {
    system: `You edit a LinkedIn post. Apply the instruction and return ONLY the revised post text (no quotes, no commentary).
Keep every fact exactly as is — do not add numbers, names or claims. Keep the hashtags line. Keep it under 3000 characters.`,
    user: `INSTRUCTION: ${instruction}\n\nPOST:\n"""${text}"""`,
  };
}

export const QUICK_PROMPTS = [
  { label: 'Summarize this role', text: 'Summarize this role: company, role, location/remote, stipend/salary, duration, deadline, and the must-have skills. Use a short bullet list.' },
  { label: 'Am I eligible?', text: 'Am I eligible for this? Check batch/graduation year, branch, CGPA, and location requirements against my profile. Quote each requirement.' },
  { label: 'Skills I am missing', text: 'Which required or preferred skills on this page are missing from my profile? For each, suggest the fastest way to show it (small project, course, or rephrasing an existing project).' },
  { label: 'Prep questions', text: 'List 8 likely interview questions for this role (technical + HR), tailored to this page and my projects.' },
];
