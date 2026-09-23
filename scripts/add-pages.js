// Agrega paginas editoriales a data/pages.json sin pisar las existentes.
//
//   node scripts/add-pages.js nuevas.json
//
// El archivo puede ser un array de items o un objeto { "items": [...] }.
// Si un slug ya existe, se salta (no se sobrescribe). Si un item no pasa la
// validacion de guard.js, no se agrega nada y sale con codigo 1.

import { readFileSync, writeFileSync } from "node:fs";
import { validateItem } from "./guard.js";

const file = process.argv[2];
if (!file) {
  console.error("Uso: node scripts/add-pages.js <archivo.json>");
  process.exit(1);
}

const input = JSON.parse(readFileSync(file, "utf8"));
const incoming = Array.isArray(input) ? input : input.items;
if (!Array.isArray(incoming)) {
  console.error("El archivo debe ser un array o un objeto con \"items\".");
  process.exit(1);
}

const PAGES = "data/pages.json";
const data = JSON.parse(readFileSync(PAGES, "utf8"));
const existing = new Set(data.items.map((p) => p.slug));

let bad = false;
for (const it of incoming) {
  const errs = validateItem(it);
  if (errs.length) {
    bad = true;
    console.error(`✗ ${it.slug || "(sin slug)"}\n    ${errs.join("\n    ")}`);
  }
}
if (bad) {
  console.error("\nNo se agrego nada. Corrige los items y vuelve a correr.");
  process.exit(1);
}

let added = 0;
for (const it of incoming) {
  if (existing.has(it.slug)) {
    console.log(`= ${it.slug} ya existe, se salta`);
    continue;
  }
  data.items.push(it);
  existing.add(it.slug);
  added++;
  console.log(`+ ${it.slug}${it.verified ? "" : " (noindex)"}`);
}

writeFileSync(PAGES, JSON.stringify(data, null, 2) + "\n");
console.log(`\n${added} agregadas, ${incoming.length - added} saltadas. Ahora: npm run build`);
