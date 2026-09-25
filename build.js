import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { layout, esc, money, adUnit } from "./lib/html.js";

const cfg = JSON.parse(readFileSync("site.config.json", "utf8"));
const vehicles = JSON.parse(readFileSync("data/vehicles.json", "utf8")).items;
const businesses = JSON.parse(readFileSync("data/businesses.json", "utf8")).items;
const pages = JSON.parse(readFileSync("data/pages.json", "utf8")).items;

const OUT = "dist";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const written = [];

function emit(path, html, { indexable = true } = {}) {
  const file = join(OUT, path === "/" ? "index.html" : path.replace(/^\//, "") + "index.html");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  if (indexable) written.push(path);
}

/** Aviso reutilizable para datos aun no confirmados. */
const unverifiedNotice = `<div class="notice notice-warn">
  <strong>Unconfirmed data.</strong> This entry is a placeholder. The game has not released yet,
  so no verified stats exist. This page is excluded from search engines until the data is confirmed.
</div>`;

/* ---------- Home ---------- */
{
  // Tarjetas para cada pagina editorial indexable, generadas desde data/pages.json.
  // Sin esto las paginas nuevas nacen huerfanas: nada las enlaza y Google no las descubre.
  const yaEnTarjetas = new Set(["release-date"]);
  const editoriales = pages
    .filter((p) => p.verified === true && !yaEnTarjetas.has(p.slug))
    .map(
      (p) =>
        `  <a class="card" href="/${esc(p.slug)}/"><h2>${esc(p.title)}</h2><p>${esc(p.description)}</p></a>`
    )
    .join("\n");

  const seccionEditoriales = editoriales
    ? `
<section class="prose">
  <h2>Answers, with sources</h2>
  <p>Questions where the press is printing things its own sources do not say. Every page below
  states who said what, and links the original.</p>
</section>

<section class="cards">
${editoriales}
</section>
`
    : "";

  const body = `
<section class="hero">
  <h1>${esc(cfg.siteName)}</h1>
  <p class="lede">${esc(cfg.tagline)}</p>
  <div id="countdown" class="countdown" data-launch="${esc(cfg.launchISO)}">
    <span class="cd-label">Counting down to launch</span>
    <span class="cd-value">—</span>
  </div>
</section>

<section class="cards">
  <a class="card" href="/vehicles/"><h2>Vehicle database</h2><p>Every vehicle, with stats, class and price. Filterable.</p></a>
  <a class="card" href="/businesses/"><h2>Business index</h2><p>Setup costs, income per hour and payback time.</p></a>
  <a class="card" href="/tools/business-calculator/"><h2>Profit calculator</h2><p>Work out ROI before you spend in-game money.</p></a>
  <a class="card" href="/release-date/"><h2>Release date</h2><p>What Rockstar has actually confirmed.</p></a>
</section>
${seccionEditoriales}
<section class="prose">
  <h2>Why this site exists</h2>
  <p>Most game reference sites bury the number you came for under three paragraphs and five ads.
  This one puts the data first. Every figure is labelled confirmed or unconfirmed, and nothing
  unverified is presented as fact.</p>
</section>`;

  emit("/", layout(cfg, {
    title: `${cfg.siteName} — ${cfg.tagline}`,
    description: "Vehicle database, business profit calculators and maps. Data-first, clearly sourced, no filler.",
    path: "/",
    body,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: cfg.siteName,
      url: cfg.domain,
    },
  }));
}

/* ---------- Colecciones genericas ---------- */
function buildCollection({ items, base, label, singular, columns, detail }) {
  const rows = items.map((it) => `<tr>
    <td><a href="${base}${it.slug}/">${esc(it.name)}</a></td>
    ${columns.map((c) => `<td>${c.render(it)}</td>`).join("")}
    <td>${it.verified ? '<span class="tag tag-ok">confirmed</span>' : '<span class="tag tag-warn">unconfirmed</span>'}</td>
  </tr>`).join("\n");

  const body = `
<h1>${esc(label)}</h1>
<p class="lede">${items.length} ${items.length === 1 ? singular : label.toLowerCase()} listed. Sortable table, no pagination traps.</p>
<div class="table-wrap">
<table class="data">
  <thead><tr><th>Name</th>${columns.map((c) => `<th>${esc(c.head)}</th>`).join("")}<th>Status</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</div>`;

  emit(base, layout(cfg, {
    title: label,
    description: `Complete ${label.toLowerCase()} list with stats, updated as data is confirmed.`,
    path: base,
    body,
    breadcrumbs: [{ name: "Home", path: "/" }, { name: label, path: base }],
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: label,
      numberOfItems: items.length,
      itemListElement: items.map((it, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: it.name,
        url: cfg.domain.replace(/\/$/, "") + base + it.slug + "/",
      })),
    },
  }));

  for (const it of items) {
    const path = `${base}${it.slug}/`;
    emit(path, layout(cfg, {
      title: it.name,
      description: it.summary || `${it.name} — stats, price and details.`,
      path,
      noindex: !it.verified,
      body: detail(it),
      breadcrumbs: [
        { name: "Home", path: "/" },
        { name: label, path: base },
        { name: it.name, path },
      ],
    }), { indexable: it.verified });
  }
}

buildCollection({
  items: vehicles,
  base: "/vehicles/",
  label: "Vehicles",
  singular: "vehicle",
  columns: [
    { head: "Class", render: (v) => esc(v.class || "—") },
    { head: "Top speed", render: (v) => (v.topSpeedMph ? `${v.topSpeedMph} mph` : "—") },
    { head: "Price", render: (v) => money(v.priceInGame) },
  ],
  detail: (v) => `
${v.verified ? "" : unverifiedNotice}
<h1>${esc(v.name)}</h1>
<p class="lede">${esc(v.summary || "")}</p>
<dl class="spec">
  <div><dt>Class</dt><dd>${esc(v.class || "—")}</dd></div>
  <div><dt>Top speed</dt><dd>${v.topSpeedMph ? `${v.topSpeedMph} mph` : "—"}</dd></div>
  <div><dt>Price</dt><dd>${money(v.priceInGame)}</dd></div>
  <div><dt>Seats</dt><dd>${esc(v.seats ?? "—")}</dd></div>
  <div><dt>Drivetrain</dt><dd>${esc(v.drivetrain || "—")}</dd></div>
</dl>
${adUnit(cfg, cfg.adsense?.slotInline)}
<p class="muted">Something wrong here? <a href="/about/">Send a correction.</a></p>`,
});

buildCollection({
  items: businesses,
  base: "/businesses/",
  label: "Businesses",
  singular: "business",
  columns: [
    { head: "Cost", render: (b) => money(b.purchaseCost) },
    { head: "Income/hr", render: (b) => money(b.incomePerHour) },
  ],
  detail: (b) => {
    const payback =
      b.purchaseCost && b.incomePerHour
        ? `${Math.ceil(b.purchaseCost / b.incomePerHour)} in-game hours`
        : "—";
    return `
${b.verified ? "" : unverifiedNotice}
<h1>${esc(b.name)}</h1>
<p class="lede">${esc(b.summary || "")}</p>
<dl class="spec">
  <div><dt>Purchase cost</dt><dd>${money(b.purchaseCost)}</dd></div>
  <div><dt>Income per hour</dt><dd>${money(b.incomePerHour)}</dd></div>
  <div><dt>Upgrades</dt><dd>${money(b.upgradeCost)}</dd></div>
  <div><dt>Payback time</dt><dd>${payback}</dd></div>
</dl>
${adUnit(cfg, cfg.adsense?.slotInline)}
<p><a href="/tools/business-calculator/">Run this through the profit calculator →</a></p>`;
  },
});

/* ---------- Paginas editoriales ---------- */
for (const p of pages) {
  const path = `/${p.slug}/`;
  const body = `
<h1>${esc(p.title)}</h1>
${p.sections.map((s, i) => `<section class="prose"><h2>${esc(s.h)}</h2><p>${s.p}</p></section>${i === 0 ? adUnit(cfg, cfg.adsense?.slotInline) : ""}`).join("\n")}`;

  emit(path, layout(cfg, {
    title: p.title,
    description: p.description,
    path,
    body,
    breadcrumbs: [{ name: "Home", path: "/" }, { name: p.title, path }],
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: p.title,
      description: p.description,
      mainEntityOfPage: cfg.domain.replace(/\/$/, "") + path,
    },
  }));
}

/* ---------- Calculadora ---------- */
{
  const body = `
<h1>Business Profit Calculator</h1>
<p class="lede">Enter what a business costs and what it earns. Get profit per hour, ROI and payback time before you commit in-game cash.</p>

<form class="calc" id="calc" autocomplete="off">
  <label>Purchase cost <input type="number" id="cost" min="0" step="1000" value="1500000"></label>
  <label>Upgrade cost <input type="number" id="upg" min="0" step="1000" value="0"></label>
  <label>Income per hour <input type="number" id="inc" min="0" step="1000" value="80000"></label>
  <label>Running cost per hour <input type="number" id="run" min="0" step="500" value="5000"></label>
  <label>Hours played per week <input type="number" id="hrs" min="0" step="1" value="10"></label>
</form>

<div class="results" id="results" aria-live="polite"></div>
${adUnit(cfg, cfg.adsense?.slotInline)}
<section class="prose">
  <h2>How payback is calculated</h2>
  <p>Payback time is total investment divided by net income per hour. Net income subtracts running
  costs, which is the number most guides leave out and the reason players overestimate returns.</p>
</section>

<script>
(function () {
  var f = ["cost","upg","inc","run","hrs"].map(function (id) { return document.getElementById(id); });
  var out = document.getElementById("results");
  function fmt(n) {
    if (!isFinite(n)) return "—";
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function calc() {
    var cost = +f[0].value || 0, upg = +f[1].value || 0,
        inc = +f[2].value || 0, run = +f[3].value || 0, hrs = +f[4].value || 0;
    var invest = cost + upg;
    var net = inc - run;
    var payback = net > 0 ? invest / net : Infinity;
    var weeks = net > 0 && hrs > 0 ? payback / hrs : Infinity;
    var roi = invest > 0 ? (net * 100 / invest) : 0;
    out.innerHTML =
      '<div class="res"><span>Total investment</span><strong>' + fmt(invest) + '</strong></div>' +
      '<div class="res"><span>Net profit per hour</span><strong class="' + (net > 0 ? 'pos' : 'neg') + '">' + fmt(net) + '</strong></div>' +
      '<div class="res"><span>Payback time</span><strong>' + (isFinite(payback) ? Math.ceil(payback) + ' hours' : 'never — running costs exceed income') + '</strong></div>' +
      '<div class="res"><span>At your play rate</span><strong>' + (isFinite(weeks) ? Math.ceil(weeks) + ' weeks' : '—') + '</strong></div>' +
      '<div class="res"><span>ROI per hour</span><strong>' + roi.toFixed(2) + '%</strong></div>';
  }
  f.forEach(function (el) { el.addEventListener("input", calc); });
  calc();
})();
</script>`;

  emit("/tools/business-calculator/", layout(cfg, {
    title: "Business Profit Calculator",
    description: "Calculate profit per hour, ROI and payback time for any in-game business. Free, no signup.",
    path: "/tools/business-calculator/",
    body,
    breadcrumbs: [{ name: "Home", path: "/" }, { name: "Calculator", path: "/tools/business-calculator/" }],
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Business Profit Calculator",
      applicationCategory: "UtilitiesApplication",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  }));
}

/* ---------- 404 ---------- */
writeFileSync(join(OUT, "404.html"), layout(cfg, {
  title: "Page not found",
  description: "That page does not exist.",
  path: "/404.html",
  noindex: true,
  body: `<h1>Page not found</h1><p class="lede">That page does not exist. Try the <a href="/vehicles/">vehicle database</a>.</p>`,
}));

/* ---------- sitemap + robots ---------- */
const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(OUT, "sitemap.xml"),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${written.map((p) => `  <url><loc>${cfg.domain.replace(/\/$/, "") + p}</loc><lastmod>${today}</lastmod></url>`).join("\n")}
</urlset>`);

writeFileSync(join(OUT, "robots.txt"),
`User-agent: *
Allow: /
Sitemap: ${cfg.domain.replace(/\/$/, "")}/sitemap.xml
`);

if (existsSync("public")) cpSync("public", OUT, { recursive: true });

console.log(`Listo. ${written.length} paginas indexables en sitemap.`);
console.log(`Total generado: ${written.length} indexables + no-index (datos sin confirmar).`);
