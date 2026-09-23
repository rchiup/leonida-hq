// Frenos del proyecto. Lo usan add-pages.js (validacion por item) y el agente
// autonomo (node scripts/guard.js --agent) antes de cada commit.
//
//   node scripts/guard.js           revisa data/pages.json y archivos criticos
//   node scripts/guard.js --agent   ademas: solo data/*.json modificado, sin borrar
//                                   paginas, tope de paginas nuevas por corrida
//
// Sale con codigo 1 si algo no pasa. No arregla nada: solo frena.

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const ALLOWED_SOURCES = [
  "rockstargames.com",
  "take2games.com",
  "ign.com",
  "eurogamer.net",
  "gamespot.com",
  "pcgamer.com",
  "gamesradar.com",
  "kotaku.com",
  "forbes.com",
  "variety.com",
  "billboard.com",
  "bloomberg.com",
  "dazeddigital.com",
];

// Nada de la filtracion, nada de gta.wiki, nada de fuentes basura.
const BANNED_PATTERNS = [
  [/cyberleek/i, "menciona la filtracion Cyberleek (regla 5)"],
  [/gta\.wiki/i, "usa gta.wiki (regla 6, licencia NonCommercial)"],
  [/sportskeeda/i, "usa sportskeeda como referencia"],
  [/<img\b/i, "incrusta una imagen (regla 7, no alojar assets)"],
  [/\.(png|jpe?g|webp|gif)(["'?#\s]|$)/i, "enlaza o incrusta un archivo de imagen (regla 7)"],
];

const CRITICAL_FILES = ["public/googlebce07ec590b3fc8d.html"];
const AGENT_WRITABLE = /^data\/[^/]+\.json$/;
const AGENT_MAX_NEW_PAGES = 3;

const hostOf = (src) =>
  String(src).replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0].toLowerCase();

export const isAllowedSource = (src) => {
  const host = hostOf(src);
  return ALLOWED_SOURCES.some((d) => host === d || host.endsWith("." + d));
};

/** Devuelve la lista de problemas de un item de pages.json (vacia = ok). */
export function validateItem(it) {
  const errs = [];
  if (!it || typeof it !== "object") return ["no es un objeto"];

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(it.slug || "")) errs.push(`slug invalido: "${it.slug}"`);
  if (!it.title || typeof it.title !== "string") errs.push("falta title");
  if (/\bGTA\b|Grand Theft Auto/i.test(it.slug || "") ) errs.push("el slug no puede llevar la marca (regla 3)");

  const d = it.description || "";
  if (d.length < 140 || d.length > 160) errs.push(`description de ${d.length} caracteres (debe ser 140-160)`);

  if (typeof it.verified !== "boolean") errs.push("verified debe ser true o false");

  if (!Array.isArray(it.sections) || it.sections.length === 0) {
    errs.push("sections vacio");
  } else {
    it.sections.forEach((s, i) => {
      if (!s.h || !s.p) errs.push(`seccion ${i + 1} sin h o p`);
    });
  }

  const sources = Array.isArray(it.sources) ? it.sources : [];
  if (it.verified) {
    if (sources.length === 0) errs.push("verified:true sin sources");
    for (const s of sources) {
      if (!isAllowedSource(s)) errs.push(`fuente no admitida para verified:true: ${s}`);
    }
  }

  const blob = JSON.stringify(it);
  for (const [re, why] of BANNED_PATTERNS) if (re.test(blob)) errs.push(why);

  return errs;
}

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function headPages() {
  const raw = git("show HEAD:data/pages.json");
  if (!raw) return [];
  try {
    return JSON.parse(raw).items || [];
  } catch {
    return [];
  }
}

function main() {
  const agent = process.argv.includes("--agent");
  const problems = [];

  for (const f of CRITICAL_FILES) if (!existsSync(f)) problems.push(`falta ${f} (no se borra nunca)`);

  const cfg = JSON.parse(readFileSync("site.config.json", "utf8"));
  if (/\bGTA\b/i.test(`${cfg.siteName} ${cfg.domain}`)) problems.push("la marca o el dominio llevan GTA (regla 3)");

  const pages = JSON.parse(readFileSync("data/pages.json", "utf8")).items;
  const before = new Map(headPages().map((p) => [p.slug, JSON.stringify(p)]));

  const seen = new Set();
  for (const p of pages) {
    if (seen.has(p.slug)) problems.push(`slug duplicado: ${p.slug}`);
    seen.add(p.slug);
    // Las paginas anteriores al guard no tienen sources; solo se exige a lo nuevo o editado.
    const touched = before.get(p.slug) !== JSON.stringify(p);
    if (!touched) continue;
    for (const e of validateItem(p)) problems.push(`${p.slug}: ${e}`);
  }

  if (agent) {
    const changed = [
      ...(git("diff --name-only HEAD") || "").split("\n"),
      ...(git("ls-files --others --exclude-standard") || "").split("\n"),
    ].filter(Boolean);
    for (const f of changed) if (!AGENT_WRITABLE.test(f)) problems.push(`el agente no puede tocar ${f}`);

    for (const slug of before.keys()) if (!seen.has(slug)) problems.push(`se borro la pagina ${slug}`);

    const added = pages.filter((p) => !before.has(p.slug)).length;
    if (added > AGENT_MAX_NEW_PAGES) problems.push(`${added} paginas nuevas (tope por corrida: ${AGENT_MAX_NEW_PAGES})`);
  }

  if (problems.length) {
    console.error("GUARD: NO PASA\n" + problems.map((p) => "  - " + p).join("\n"));
    process.exit(1);
  }
  console.log(`GUARD: ok (${pages.length} paginas${agent ? ", modo agente" : ""})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
