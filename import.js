/**
 * Importador. Esto es lo que convierte esto en un sitio de miles de paginas
 * el dia del lanzamiento sin que escribas una pagina a mano.
 *
 *   node import.js vehicles archivo.csv
 *   node import.js businesses archivo.csv
 *
 * El CSV necesita una fila de encabezados. Los nombres de columna se mapean
 * abajo en FIELDS. Lo que no matchea se ignora en vez de romper la corrida.
 * Las filas nuevas se agregan; las que ya existen (mismo slug) se actualizan
 * sin borrar campos que el CSV no traiga.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { slugify } from "./lib/html.js";

const FIELDS = {
  vehicles: {
    name: ["name", "vehicle", "title"],
    class: ["class", "category", "type"],
    topSpeedMph: ["topspeed", "top_speed", "topspeedmph", "speed"],
    priceInGame: ["price", "cost", "priceingame"],
    seats: ["seats"],
    drivetrain: ["drivetrain", "drive"],
    summary: ["summary", "description", "desc"],
  },
  businesses: {
    name: ["name", "business", "title"],
    purchaseCost: ["cost", "purchasecost", "price"],
    incomePerHour: ["income", "incomeperhour", "perhour"],
    upgradeCost: ["upgrade", "upgradecost"],
    summary: ["summary", "description", "desc"],
  },
};

const NUMERIC = new Set(["topSpeedMph", "priceInGame", "seats", "purchaseCost", "incomePerHour", "upgradeCost"]);

/** Parser de CSV que respeta comillas y comas adentro de campos. */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const [, , kind, file] = process.argv;
if (!kind || !file || !FIELDS[kind]) {
  console.error("Uso: node import.js <vehicles|businesses> <archivo.csv>");
  process.exit(1);
}

const rows = parseCSV(readFileSync(file, "utf8"));
if (rows.length < 2) { console.error("El CSV no tiene filas de datos."); process.exit(1); }

const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
const map = FIELDS[kind];

// indice de columna por cada campo conocido
const colFor = {};
for (const [field, aliases] of Object.entries(map)) {
  const idx = headers.findIndex((h) => aliases.includes(h));
  if (idx !== -1) colFor[field] = idx;
}
if (colFor.name === undefined) {
  console.error("No encontre una columna de nombre. Encabezados vistos:", headers.join(", "));
  process.exit(1);
}

const dbPath = `data/${kind}.json`;
const db = JSON.parse(readFileSync(dbPath, "utf8"));
const bySlug = new Map(db.items.map((it) => [it.slug, it]));

let added = 0, updated = 0, skipped = 0;

for (const r of rows.slice(1)) {
  const name = (r[colFor.name] || "").trim();
  if (!name) { skipped++; continue; }
  const slug = slugify(name);

  const rec = bySlug.get(slug) || { slug, verified: true };
  rec.name = name;

  for (const [field, idx] of Object.entries(colFor)) {
    if (field === "name") continue;
    const raw = (r[idx] || "").trim();
    if (raw === "") continue;
    if (NUMERIC.has(field)) {
      const n = Number(raw.replace(/[$,\s]/g, ""));
      if (Number.isFinite(n)) rec[field] = n;
    } else {
      rec[field] = raw;
    }
  }
  // Solo se marca confirmado si trae al menos un dato duro ademas del nombre.
  rec.verified = Object.keys(rec).some((k) => NUMERIC.has(k) && rec[k] != null);

  if (bySlug.has(slug)) updated++;
  else { db.items.push(rec); bySlug.set(slug, rec); added++; }
}

db.items.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(dbPath, JSON.stringify(db, null, 2) + "\n");

console.log(`${kind}: ${added} nuevos, ${updated} actualizados, ${skipped} filas vacias.`);
console.log(`Total en base: ${db.items.length}. Ahora corre: npm run build`);
