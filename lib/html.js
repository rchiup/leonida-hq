// Utilidades de plantilla. Sin dependencias externas a proposito:
// esto tiene que seguir compilando dentro de 3 anos sin que nada se rompa.

export const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const slugify = (s = "") =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const money = (n) =>
  typeof n === "number" ? "$" + n.toLocaleString("en-US") : "—";

function adUnit(cfg, slot) {
  if (!cfg.adsense?.enabled) {
    return `<div class="ad-slot" aria-hidden="true"><span>espacio publicitario</span></div>`;
  }
  return `<ins class="adsbygoogle" style="display:block"
     data-ad-client="${esc(cfg.adsense.client)}"
     data-ad-slot="${esc(slot)}"
     data-ad-format="auto" data-full-width-responsive="true"></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>`;
}

/**
 * Envoltura de pagina. Todo lo que afecta SEO vive aca, en un solo lugar,
 * para que ninguna pagina generada pueda salir sin canonical ni descripcion.
 */
export function layout(cfg, page) {
  const {
    title,
    description,
    path,           // "/vehicles/comet-s2/"
    body,
    jsonLd = null,
    breadcrumbs = [],
    noindex = false,
  } = page;

  const url = cfg.domain.replace(/\/$/, "") + path;
  const fullTitle = path === "/" ? title : `${title} | ${cfg.siteName}`;

  const crumbLd = breadcrumbs.length
    ? {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: breadcrumbs.map((b, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: b.name,
          item: cfg.domain.replace(/\/$/, "") + b.path,
        })),
      }
    : null;

  const ld = [jsonLd, crumbLd].filter(Boolean);

  return `<!doctype html>
<html lang="${esc(cfg.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
${noindex ? '<meta name="robots" content="noindex,follow">' : ""}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(cfg.siteName)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:locale" content="${esc(cfg.locale)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css">
${ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("\n")}
${cfg.analytics?.plausibleDomain ? `<script defer data-domain="${esc(cfg.analytics.plausibleDomain)}" src="https://plausible.io/js/script.js"></script>` : ""}
${cfg.adsense?.enabled ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(cfg.adsense.client)}" crossorigin="anonymous"></script>` : ""}
</head>
<body>
<header class="site-head">
  <a class="brand" href="/"><span class="brand-mark">LHQ</span> ${esc(cfg.siteName)}</a>
  <nav>
    <a href="/vehicles/">Vehicles</a>
    <a href="/businesses/">Businesses</a>
    <a href="/tools/business-calculator/">Calculator</a>
    <a href="/release-date/">Release</a>
  </nav>
</header>

${breadcrumbs.length ? `<div class="crumbs"><div class="wrap">${breadcrumbs
    .map((b, i) =>
      i === breadcrumbs.length - 1
        ? `<span>${esc(b.name)}</span>`
        : `<a href="${esc(b.path)}">${esc(b.name)}</a><span class="sep">/</span>`
    )
    .join("")}</div></div>` : ""}

<main class="wrap">
${adUnit(cfg, cfg.adsense?.slotTop)}
${body}
</main>

<footer class="site-foot">
  <div class="wrap">
    <p><strong>${esc(cfg.siteName)}</strong> — ${esc(cfg.tagline)}</p>
    <p class="disclaimer">Unofficial fan-made resource. Not affiliated with, endorsed by, or sponsored by Rockstar Games or Take-Two Interactive. All trademarks belong to their respective owners.</p>
    <p class="muted">Data on this site is community-sourced and may be incomplete. <a href="/about/">About &amp; corrections</a></p>
  </div>
</footer>
<script src="/countdown.js" defer></script>
</body>
</html>`;
}

export { adUnit };
