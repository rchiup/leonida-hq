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
  // Take-Two publica sus comunicados oficiales en su host de relaciones con
  // inversionistas, no en take2games.com. Va el host COMPLETO a proposito:
  // gcs-web.com es un proveedor de IR compartido y poner el sufijo abriria
  // la puerta a los comunicados de cualquier otra empresa que lo use.
  "taketwointeractivesoftwareinc.gcs-web.com",
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

const CRITICAL_FILES = [
  "public/googlebce07ec590b3fc8d.html",
  "public/google2f81ceee882d8fa6.html",
];
const AGENT_WRITABLE = /^data\/[^/]+\.json$/;
const AGENT_MAX_NEW_PAGES = 3;
// Paginas nuevas del agente: minimo de palabras en las secciones. Las de ~150 palabras
// son contenido delgado (el sitio ya recibio un spam update); mejor 0 paginas que una floja.
export const AGENT_MIN_WORDS = 250;


// ---------- Idioma ----------
// El sitio es en ingles. El agente investiga en español y a veces deja el texto
// de las paginas en español (run #9, 30-09-2026: 3 paginas salieron asi). No hay
// que adivinar el idioma con una libreria: se cuentan palabras funcionales de
// cada idioma. Probado contra las 19 paginas publicadas: las en ingles dan 0-1
// palabras españolas y las 3 en español dan 35-44, asi que el margen es enorme.
const ES_WORDS = new Set(
  ("de la el los las que en del con por para una un se es su al como más pero sus le ya o este sí " +
   "porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante " +
   "ni contra otros ese eso ante ellos e esto antes algunos qué unos yo otro otras otra él tanto esa " +
   "estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros ha han fue ser " +
   "son será serán está están lanzamiento fecha según además aún todavía tiene tienen").split(" ")
);
const EN_WORDS = new Set(
  ("the of and to in is that for it as was with on are by this be at from or an not have has will " +
   "been which their its also but they were his her than into can would about after before over only").split(" ")
);

export function langScore(text) {
  const words = String(text).toLowerCase().replace(/<[^>]+>/g, " ").match(/[a-záéíóúñü]+/g) || [];
  let es = 0, en = 0;
  for (const w of words) {
    if (ES_WORDS.has(w)) es++;
    if (EN_WORDS.has(w)) en++;
  }
  const accents = (String(text).match(/[áéíóúñ¿¡]/gi) || []).length;
  return { es, en, accents };
}

/** true si el texto parece estar en español. */
export function looksSpanish(text) {
  const { es, en, accents } = langScore(text);
  return (es >= 5 && es > en) || accents >= 3;
}

const hostOf = (src) =>
  String(src).replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0].toLowerCase();

export const isAllowedSource = (src) => {
  const host = hostOf(src);
  return ALLOWED_SOURCES.some((d) => host === d || host.endsWith("." + d));
};

/**
 * true si la URL apunta a algo concreto (un articulo, un comunicado, una
 * pagina del juego), no a la portada de un sitio. "https://www.take2games.com"
 * o "https://www.rockstargames.com/" no respaldan ninguna afirmacion puntual.
 */
export function isConcreteSource(src) {
  const rest = String(src).replace(/^https?:\/\//i, "").replace(/[?#].*$/, "");
  const i = rest.indexOf("/");
  if (i === -1) return false;
  return rest.slice(i).replace(/\/+$/, "").length > 0;
}

/**
 * Temas de elenco (actores, voces, casting): casi toda la informacion que hay
 * sobre esto sale de filtraciones o de segunda mano (regla 4 del prompt), asi
 * que nunca pueden ir como verificados. Solo se mira slug, titulo y
 * description para no saltarse paginas que mencionan a un actor de pasada.
 */
export const CAST_RE = /\b(cast|casting|actor|actors|actress|actresses|voice[ -]?actor|voice[ -]?actors|voiced by|voice cast|stars as)\b/i;
export const isCastTopic = (it) =>
  CAST_RE.test(`${String(it.slug || "").replace(/-/g, " ")} ${it.title || ""} ${it.description || ""}`);

/** Devuelve la lista de problemas de un item de pages.json (vacia = ok). */
export function validateItem(it, { minWords = 0 } = {}) {
  const errs = [];
  if (!it || typeof it !== "object") return ["no es un objeto"];

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(it.slug || "")) errs.push(`slug invalido: "${it.slug}"`);
  if (!it.title || typeof it.title !== "string") errs.push("falta title");
  if (/\bGTA\b|Grand Theft Auto/i.test(it.slug || "") ) errs.push("el slug no puede llevar la marca (regla 3)");

  const d = it.description || "";
  // 140-170: Google corta el snippet cerca de los 155-160 caracteres, asi que
  // pasarse por poco solo significa que se muestra con puntos suspensivos. Botar
  // una pagina entera por 6 caracteres de mas es perder trabajo bueno por nada,
  // y recortar el texto a maquina deja frases cojas, que es peor que el corte
  // de Google. Se acepta el margen y el prompt pide apuntar a 150.
  // Solo tope, sin minimo. Los modelos no saben contar caracteres: pedir un
  // rango exacto convierte cada corrida en una loteria (166 en la #7, 135 en la
  // #8). Una description corta no esta rota, solo es corta; una larga si se ve
  // mal porque Google la corta. Se controla lo que importa y se suelta el resto.
  if (d.length > 170) errs.push(`description de ${d.length} caracteres (maximo 170)`);
  if (d.length < 50) errs.push(`description de ${d.length} caracteres: demasiado corta para servir de snippet`);

  if (typeof it.verified !== "boolean") errs.push("verified debe ser true o false");

  if (!Array.isArray(it.sections) || it.sections.length === 0) {
    errs.push("sections vacio");
  } else {
    it.sections.forEach((s, i) => {
      if (!s.h || !s.p) errs.push(`seccion ${i + 1} sin h o p`);
    });
  }

  if (minWords > 0 && Array.isArray(it.sections)) {
    const palabras = it.sections.map((s) => `${s.h || ""} ${s.p || ""}`).join(" ").trim().split(/\s+/).filter(Boolean).length;
    if (palabras < minWords) errs.push(`contenido demasiado corto: ${palabras} palabras (minimo ${minWords}). Sin material para eso, mejor no publicar la pagina`);
  }

  const sources = Array.isArray(it.sources) ? it.sources : [];
  if (it.verified) {
    if (sources.length === 0) errs.push("verified:true sin sources");
    for (const s of sources) {
      if (!isAllowedSource(s)) errs.push(`fuente no admitida para verified:true: ${s}`);
    }
    if (sources.length > 0 && !sources.some(isConcreteSource)) {
      errs.push("verified:true con fuentes que son solo la portada de un sitio: hace falta al menos una URL concreta (articulo o comunicado)");
    }
    if (isCastTopic(it)) errs.push("tema de elenco (cast/actores/voces): no puede ir como verified:true");
  }

  const prose = [it.title, it.description, ...(Array.isArray(it.sections) ? it.sections.flatMap((s) => [s.h, s.p]) : [])]
    .filter(Boolean)
    .join(" ");
  if (looksSpanish(prose)) errs.push("el texto esta en español: todo el contenido debe ir en ingles");

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
    const nueva = agent && !before.has(p.slug);
    for (const e of validateItem(p, { minWords: nueva ? AGENT_MIN_WORDS : 0 })) problems.push(`${p.slug}: ${e}`);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
