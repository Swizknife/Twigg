// Runs on every page you open (top frame only). It looks for job/internship/hackathon data that is
// ALREADY on the page — structured JobPosting data, or a known job site — and tells the extension.
// Nothing is sent anywhere else, and nothing is reported for pages that aren't job-like.

(() => {
  // An older copy may still be running in this tab (Twigg was reloaded): stop its timers, then take over.
  for (const id of window.__twiggTimers || []) clearTimeout(id); // clearTimeout also stops intervals
  window.__twiggTimers = [];
  window.__twiggDetect = true;

  const E = window.TwiggExtract;
  const adapter = () => window.TwiggAdapters.forPage();

  function collect() {
    const roles = [];
    const structured = E.jobPostings();
    for (const j of structured) {
      roles.push({
        title: j.title,
        company: j.company,
        location: j.location,
        remote: j.remote,
        stipend: j.salary,
        deadline: j.validThrough,
        posted: j.datePosted,
        employmentType: j.employmentType,
        skills: j.skills,
        description: j.description,
        url: location.href,
        isDetail: true,
      });
    }
    const a = adapter();
    if (a?.list) roles.push(...a.list());
    // site-specific detail reader only when the page has no structured data (or for hackathons)
    if (a?.detail && !structured.length) {
      const d = a.detail();
      if (d) roles.push(d);
    }
    return roles.filter((r) => r.title && r.url);
  }

  let lastSignature = '';
  function report() {
    let roles;
    try {
      roles = collect();
    } catch (err) {
      console.debug('Twigg: could not read this page', err);
      return;
    }
    if (!roles.length) return;
    const signature = `${location.href}|${roles.length}|${roles[0].title}|${roles[roles.length - 1].title}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    chrome.runtime.sendMessage({ type: 'twigg-roles', roles, page: { url: location.href, title: document.title } }).catch(() => {});
  }

  // the side panel's "Scan this page" reads the roles directly (it doesn't depend on this script's messages)
  window.__twiggCollect = () => collectSafe();

  // force a fresh report to the background
  window.__twiggReport = () => {
    lastSignature = '';
    report();
    return collectSafe().length;
  };
  function collectSafe() {
    try {
      return collect();
    } catch {
      return [];
    }
  }

  /**
   * "Copy page details" in the side panel: the page's STRUCTURE only — link patterns (ids and slugs masked),
   * structured-data types and the class names around job links. No visible text, names or URLs with values,
   * so it is safe to paste into a chat when teaching Twigg a new page layout.
   */
  window.__twiggDiagnose = () => {
    // structural words are kept; anything else after the first path segment (names, slugs) is masked
    const STRUCTURE = /^(view|search|collections?|recommended|details?|jobs?|internships?|apply|company|companies|careers?|postings?|opportunit(y|ies)|competitions?|hackathons?|o|p|in|list|listing|results)$/i;
    const mask = (href) => {
      try {
        const u = new URL(href, location.href);
        const segs = u.pathname.split('/').filter(Boolean).map((s, i) => (/\d{4,}/.test(s) ? '{id}' : i === 0 || STRUCTURE.test(s) ? s : '*'));
        const params = [...u.searchParams.keys()].sort();
        return `${u.host === location.host ? '' : u.host}/${segs.join('/')}${params.length ? `?${params.join('&')}` : ''}`;
      } catch {
        return '?';
      }
    };
    const counts = {};
    for (const a of document.querySelectorAll('a[href]')) {
      const k = mask(a.getAttribute('href'));
      counts[k] = (counts[k] || 0) + 1;
    }
    const linkPatterns = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const withIds = [...document.querySelectorAll('a[href]')].filter((a) => /\d{4,}/.test(a.getAttribute('href'))).slice(0, 3);
    const chain = (el) => {
      const out = [];
      for (let n = el, i = 0; n && i < 6; n = n.parentElement, i++) out.push(`${n.tagName.toLowerCase()}${n.className && typeof n.className === 'string' ? `.${n.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''}`);
      return out.join(' < ');
    };
    const a = window.TwiggAdapters?.forPage();
    return {
      twigg: 'page-structure-v1',
      page: `${location.host}/${location.pathname.split('/').filter(Boolean).map((s, i) => (/\d{4,}/.test(s) ? '{id}' : i < 2 ? s : '*')).join('/')}`,
      structuredData: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { const j = JSON.parse(s.textContent); return [].concat(j['@graph'] || j).map((x) => x['@type']).join(','); } catch { return '?'; } }),
      linkCount: document.links.length,
      linkPatterns,
      aroundIdLinks: withIds.map(chain),
      reader: a ? 'site reader' : 'none',
      readerFound: collectSafe().length,
    };
  };

  // Pages load their data at different times; check shortly after load, then keep an eye on job sites
  // (they swap content without a page load as you scroll or change filters).
  window.__twiggTimers.push(setTimeout(report, 1500), setTimeout(report, 5000));
  if (adapter() || E.jobPostings().length) {
    let ticks = 0;
    let lastShape = '';
    const timer = setInterval(() => {
      // re-read only when the page changed (cheap check — LinkedIn pages have thousands of links)
      const shape = `${location.href}|${document.links.length}`;
      if (shape !== lastShape) {
        lastShape = shape;
        report();
      }
      if (++ticks > 600) clearInterval(timer); // ~25 minutes, then stop
    }, 2500);
    window.__twiggTimers.push(timer);
  }
})();
