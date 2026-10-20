// Injected into the current tab on demand. Reads the page as clean text.
// Re-injecting into the same tab is harmless: it only redefines these read-only helpers.

(() => {
  // No "already loaded" check: after Twigg is reloaded, an OLDER copy of this script can still live in tabs that
  // were open, and skipping would leave that old code running. Defining again simply replaces it.

  function clean(text) {
    return text
      .replace(/[ \t ]+/g, ' ')
      .replace(/\n /g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function stripHtml(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    return clean(doc.body?.innerText || doc.body?.textContent || '');
  }

  /** schema.org JobPosting blocks — most ATS pages (Greenhouse, Lever, Workday, Indeed) publish one. */
  function jobPostings() {
    const found = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(visit);
      const type = [].concat(node['@type'] || []);
      if (type.includes('JobPosting')) found.push(node);
      if (node['@graph']) visit(node['@graph']);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        visit(JSON.parse(script.textContent));
      } catch {}
    }
    return found.map((job) => ({
      title: job.title,
      company: [].concat(job.hiringOrganization || [])[0]?.name,
      location: [...new Set([].concat(job.jobLocation || []).flatMap((l) => [].concat(l.address?.addressLocality || l.address?.addressRegion || [])).filter(Boolean))].join(', '),
      remote: job.jobLocationType === 'TELECOMMUTE',
      employmentType: [].concat(job.employmentType || []).join(', '),
      datePosted: job.datePosted,
      validThrough: job.validThrough,
      salary: salaryText(job.baseSalary),
      skills: typeof job.skills === 'string' ? job.skills.split(/[,\n]/) : job.skills,
      description: stripHtml(job.description),
    }));
  }

  /** baseSalary → plain text the stipend parser understands, e.g. "INR 7500-15000 MONTH". */
  function salaryText(base) {
    const b = [].concat(base || [])[0];
    if (!b) return '';
    const v = b.value && typeof b.value === 'object' ? b.value : b;
    const cur = b.currency || v.currency || '';
    const unit = v.unitText || '';
    if (v.minValue != null || v.maxValue != null) return `${cur} ${v.minValue ?? ''}${v.maxValue != null ? `-${v.maxValue}` : ''} ${unit}`.trim();
    if (v.value != null) return `${cur} ${v.value} ${unit}`.trim();
    return '';
  }

  /** Main readable text: prefer <main>/<article> when they hold most of the content. */
  function mainText() {
    const body = document.body?.innerText || '';
    const candidates = document.querySelectorAll('main, article, [role="main"]');
    for (const el of candidates) {
      const text = el.innerText || '';
      if (text.length > 800 && text.length > body.length * 0.4) return text;
    }
    return body;
  }

  function page(maxChars = 60000) {
    const jobs = jobPostings();
    let text = clean(mainText());
    // Structured job data is the cleanest source — put it first when present.
    if (jobs.length) {
      const header = jobs
        .map((j) => `[Structured job data] ${j.title || ''} at ${j.company || ''} | ${j.location || ''}${j.remote ? ' | Remote' : ''} | Posted ${j.datePosted || '?'} | Apply by ${j.validThrough || '?'}\n${j.description}`)
        .join('\n\n');
      text = `${header}\n\n[Visible page text]\n${text}`;
    }
    const truncated = text.length > maxChars;
    return {
      url: location.href,
      title: document.title,
      selection: clean(String(window.getSelection() || '')).slice(0, 4000),
      text: truncated ? `${text.slice(0, maxChars)}\n[...page truncated]` : text,
      truncated,
      jobPostings: jobs,
    };
  }

  window.TwiggExtract = { page, jobPostings };
})();
