// Limpia y normaliza la respuesta cruda de Groq antes de pasarla a add-pages.js.
// No repite las reglas de guard.js (descripcion, fuentes admitidas, etc.) —
// solo garantiza que lo que llega a add-pages.js sea JSON bien formado, con la
// forma correcta, y como maximo AGENT_MAX_NEW_PAGES items.
//
//   node scripts/process-agent-output.js <archivo-crudo.json> <archivo-salida.json>
//
// Sale con codigo 1 y un mensaje legible si la respuesta no se puede rescatar.

import { readFileSync, writeFileSync } from "node:fs";

const MAX_NEW_PAGES = 3; // debe calzar con AGENT_MAX_NEW_PAGES en scripts/guard.js

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error("Uso: node scripts/process-agent-output.js <entrada> <salida>");
  process.exit(1);
}

const raw = readFileSync(inFile, "utf8");

function extraerJSON(texto) {
  // Quita bloques de codigo markdown tipo ```json ... ``` si el modelo los agrega,
  // cosa que hace seguido aunque se le pida no hacerlo.
  let t = texto.trim();
  const bloque = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (bloque) t = bloque[1].trim();

  // Si sigue habiendo texto antes/despues del JSON, recorta hasta el primer
  // "{" o "[" y el ultimo "}" o "]" que le correspondan.
  const inicio = Math.min(
    ...["{", "["].map((c) => {
      const i = t.indexOf(c);
      return i === -1 ? Infinity : i;
    })
  );
  const finLlave = t.lastIndexOf("}");
  const finCorchete = t.lastIndexOf("]");
  const fin = Math.max(finLlave, finCorchete);

  if (inicio === Infinity || fin === -1 || fin < inicio) {
    throw new Error("no se encontro nada que parezca JSON en la respuesta");
  }
  return t.slice(inicio, fin + 1);
}

let parsed;
try {
  const limpio = extraerJSON(raw);
  parsed = JSON.parse(limpio);
} catch (e) {
  console.error("✗ No se pudo interpretar la respuesta del modelo como JSON.");
  console.error(`  Motivo: ${e.message}`);
  console.error("  Primeros 500 caracteres de la respuesta cruda:");
  console.error("  " + raw.slice(0, 500).replace(/\n/g, "\n  "));
  process.exit(1);
}

let items = Array.isArray(parsed) ? parsed : parsed.items;
if (!Array.isArray(items)) {
  console.error("✗ La respuesta no tiene la forma esperada: un array, o un objeto con \"items\".");
  console.error("  Se recibio:", JSON.stringify(parsed).slice(0, 300));
  process.exit(1);
}

// Caso valido y comun: el modelo decide que no hay nada que publicar esta corrida.
if (items.length === 0) {
  writeFileSync(outFile, JSON.stringify({ items: [] }, null, 2) + "\n");
  console.log("0 items en la respuesta. Corrida vacia, resultado valido.");
  process.exit(0);
}

if (items.length > MAX_NEW_PAGES) {
  console.log(
    `Aviso: el modelo devolvio ${items.length} items, se recortan a los primeros ${MAX_NEW_PAGES} ` +
      `(el tope real lo aplica igual guard.js --agent).`
  );
  items = items.slice(0, MAX_NEW_PAGES);
}

// Chequeo estructural minimo, no de contenido: eso es trabajo de guard.js.
const conSlug = items.filter((it) => it && typeof it.slug === "string" && it.slug.length > 0);
if (conSlug.length !== items.length) {
  console.error(`✗ ${items.length - conSlug.length} item(s) sin "slug" valido. Se descarta toda la respuesta.`);
  process.exit(1);
}

writeFileSync(outFile, JSON.stringify({ items: conSlug }, null, 2) + "\n");
console.log(`${conSlug.length} item(s) listos para add-pages.js: ${conSlug.map((p) => p.slug).join(", ")}`);
