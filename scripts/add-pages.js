// Agrega paginas editoriales a data/pages.json sin pisar las existentes.
//
//   node scripts/add-pages.js nuevas.json
//
// El archivo puede ser un array de items o un objeto { "items": [...] }.
// Si un slug ya existe, se salta (no se sobrescribe).
//
// CRITERIO DE EXITO — importa entenderlo:
//
// Que el guard rechace una pagina NO es una falla del sistema, es el guard
// haciendo su pega. Antes, un solo item malo botaba los otros dos y marcaba la
// corrida en rojo; eso confunde "el agente no trajo nada publicable hoy" (que
// es normal y esperable) con "algo se rompio" (que hay que ir a mirar).
//
// Ahora:
//   - se publican los items validos y se saltan los invalidos
//   - una corrida donde no paso nada sale VERDE, con el detalle en el log
//   - solo sale en rojo lo que de verdad esta roto: archivo ilegible, forma
//     incorrecta, o que no se pueda escribir pages.json
//
// El detalle de lo rechazado se escribe igual en el resumen de la corrida, para
// que se vea sin tener que abrir los logs aunque este verde.

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { validateItem } from "./guard.js";

const file = process.argv[2];
if (!file) {
  console.error("Uso: node scripts/add-pages.js <archivo.json>");
  process.exit(1);
}

// Los modelos a veces devuelven guiones "no separables" (U+2011) y otros
// guiones raros. Es formato, no fondo: se normalizan a "-" en vez de rechazar.
const limpiarGuiones = (v) =>
  typeof v === "string"
    ? v.replace(/[\u2010\u2011\u2012]/g, "-")
    : Array.isArray(v)
      ? v.map(limpiarGuiones)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, limpiarGuiones(x)]))
        : v;

const input = limpiarGuiones(JSON.parse(readFileSync(file, "utf8")));
const incoming = Array.isArray(input) ? input : input.items;
if (!Array.isArray(incoming)) {
  console.error("El archivo debe ser un array o un objeto con \"items\".");
  process.exit(1);
}

const PAGES = "data/pages.json";
const data = JSON.parse(readFileSync(PAGES, "utf8"));
const existing = new Set(data.items.map((p) => p.slug));

const rechazados = [];
const validos = [];

for (const it of incoming) {
  const errs = validateItem(it);
  if (errs.length) {
    rechazados.push({ slug: it.slug || "(sin slug)", errs });
    console.error(`✗ ${it.slug || "(sin slug)"}\n    ${errs.join("\n    ")}`);
  } else {
    validos.push(it);
  }
}

let added = 0;
const saltados = [];
for (const it of validos) {
  if (existing.has(it.slug)) {
    console.log(`= ${it.slug} ya existe, se salta`);
    saltados.push(it.slug);
    continue;
  }
  data.items.push(it);
  existing.add(it.slug);
  added++;
  console.log(`+ ${it.slug}${it.verified ? "" : " (noindex)"}`);
}

if (added > 0) writeFileSync(PAGES, JSON.stringify(data, null, 2) + "\n");

console.log(
  `\n${added} agregada(s), ${saltados.length} ya existian, ${rechazados.length} rechazada(s).`
);

if (added === 0) {
  console.log(
    "Nada que publicar en esta corrida. No es una falla: el guard filtro lo que " +
      "no cumplia las reglas."
  );
}

// Resumen visible en la pagina de la corrida, aunque salga verde.
if (process.env.GITHUB_STEP_SUMMARY) {
  const lineas = [`### Agente: ${added} pagina(s) publicada(s)`, ""];
  for (const it of validos.filter((v) => !saltados.includes(v.slug))) {
    lineas.push(`- ✅ \`${it.slug}\`${it.verified ? "" : " (noindex)"}`);
  }
  for (const s of saltados) lineas.push(`- ⏭️ \`${s}\` — ya existia`);
  for (const r of rechazados) {
    lineas.push(`- ❌ \`${r.slug}\``);
    for (const e of r.errs) lineas.push(`  - ${e}`);
  }
  if (rechazados.length) {
    lineas.push("", "> Un rechazo no es una falla del workflow. Si se repite el " +
      "mismo motivo corrida tras corrida, ahi si hay algo que ajustar.");
  }
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lineas.join("\n") + "\n");
  } catch (_) {}
}

// Solo se sale en rojo por cosas realmente rotas, no por contenido rechazado.
process.exit(0);
