'use strict';

function normalizeContextPath(value) {
  if (value === undefined || value === null || value === '' || value === '/') return '';
  let result = String(value).trim();
  if (result === 'auto') return 'auto';
  if (!result.startsWith('/')) result = `/${result}`;
  result = result.replace(/\/+$/, '');
  if (result.includes('?') || result.includes('#')) throw new Error('Confluence context path must not contain a query or fragment');
  if (result.split('/').includes('..')) throw new Error('Confluence context path must not contain parent traversal');
  return result;
}

function parseHttpsUrl(raw, label) {
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${label} is not a valid absolute URL: ${raw}`); }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`${label} must use HTTPS: ${url.origin}`);
  }
  if (url.username || url.password) throw new Error(`${label} must not contain credentials`);
  return url;
}

function inferContextFromPageUrl(url) {
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const markers = [
    '/pages/viewpage.action',
    '/pages/releaseview.action',
    '/pages/editpage.action',
    '/display/',
    '/spaces/',
  ];
  for (const marker of markers) {
    const index = pathname.indexOf(marker);
    if (index >= 0) return normalizeContextPath(pathname.slice(0, index));
  }
  const cloudPage = pathname.match(/^(.*)\/pages\/\d+(?:\/|$)/);
  if (cloudPage) return normalizeContextPath(cloudPage[1]);
  return null;
}

function inferConfluenceDeployment({ site = '', inputs = [], contextPath = 'auto' } = {}) {
  const absoluteInputs = inputs.filter(input => /^https?:\/\//i.test(String(input))).map(input => parseHttpsUrl(input, 'Confluence input URL'));
  let siteUrl = null;
  if (site) siteUrl = parseHttpsUrl(site, '--site');
  if (!siteUrl && absoluteInputs.length) siteUrl = new URL(absoluteInputs[0].origin);
  if (!siteUrl) throw new Error('Missing Confluence site. Pass --site or provide an absolute Confluence page URL.');

  const origin = siteUrl.origin;
  for (const input of absoluteInputs) {
    if (input.origin !== origin) throw new Error(`Confluence input URL origin ${input.origin} does not match site origin ${origin}`);
  }

  let resolvedContext = normalizeContextPath(contextPath);
  if (resolvedContext === 'auto') {
    const sitePath = normalizeContextPath(siteUrl.pathname);
    if (sitePath) {
      resolvedContext = sitePath;
    } else {
      resolvedContext = null;
      for (const input of absoluteInputs) {
        const inferred = inferContextFromPageUrl(input);
        if (inferred !== null) { resolvedContext = inferred; break; }
      }
      if (resolvedContext === null) resolvedContext = /\.atlassian\.net$/i.test(siteUrl.hostname) ? '/wiki' : '';
    }
  }

  const appBase = `${origin}${resolvedContext}`;
  const apiBase = `${appBase}/rest/api`;

  function sameOrigin(raw, label = 'Confluence URL') {
    const url = new URL(raw, `${origin}/`);
    if (url.origin !== origin) throw new Error(`${label} is cross-origin: ${url.origin} (expected ${origin})`);
    return url;
  }

  function api(pathname) {
    const suffix = String(pathname || '').replace(/^\/+/, '');
    return `${apiBase}/${suffix}`;
  }

  function web(pathname) {
    if (!pathname) return appBase || origin;
    const raw = String(pathname);
    if (/^https?:\/\//i.test(raw)) return sameOrigin(raw).href;
    if (resolvedContext && (raw === resolvedContext || raw.startsWith(`${resolvedContext}/`) || raw.startsWith(`${resolvedContext}?`))) {
      return sameOrigin(`${origin}${raw}`).href;
    }
    return sameOrigin(`${appBase}/${raw.replace(/^\/+/, '')}`).href;
  }

  return {
    origin,
    contextPath: resolvedContext,
    appBase,
    apiBase,
    site: appBase,
    api,
    web,
  };
}

module.exports = {
  inferConfluenceDeployment,
  inferContextFromPageUrl,
  normalizeContextPath,
};
