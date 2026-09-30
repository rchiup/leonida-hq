// Limpia y normaliza la respuesta cruda de Groq antes de pasarla a add-pages.js.
// No repite las reglas de guard.js (descripcion, fuentes admitidas, etc.) —
// solo garantiza que lo que llega a add-pages.js sea JSON bien formado, con la
// forma correcta, y como maximo AGENT_MAX_NEW_PAGES items.
//
//   node scripts/process-agent-output.js <archivo-crudo.json> <archivo-salida.json>
//
// Sale con codigo 1 y un mensaje legible si la respuesta no se puede rescatar.

import { readFileSync, writeFileSync } from "node:fs";
import { isAllowedSource, isConcreteSource, isCastTopic } from "./guard.js";

const MAX_NEW_PAGES = 3; // debe calzar con AGENT_MAX_NEW_PAGES en scripts/guard.js

/**
 * Saca la marca del slug. El guard la prohibe (regla 3, por marcas registradas)
 * y el modelo igual la mete de vez en cuando aunque el schema se lo pida.
 * Quitarla es mecanico y no cambia el sentido, asi que se corrige en vez de
 * botar la pagina: rechazar por sustancia, normalizar por formato.
 */
function limpiarSlug(slug) {
  if (typeof slug !== "string") return { valor: slug, nota: null };
  const limpio = slug
    .toLowerCase()
    .replace(/\b(gta|grand-theft-auto)-?(vi|6)?\b/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    // Quitar la marca suele dejar un "vi" suelto en las puntas (launch-date-vi).
    .replace(/^vi(-|$)/, "")
    .replace(/-(vi|6)$/, "");
  if (!limpio || limpio === slug) return { valor: slug, nota: null };
  return { valor: limpio, nota: `slug "${slug}" -> "${limpio}" (se saco la marca)` };
}

/**
 * Los modelos chicos no saben contar caracteres y se pasan del tope de 170
 * (el 20b mando 205). Es un problema de forma, no de fondo: se recorta en el
 * ultimo fin de oracion que quepa; si no hay uno razonable, en la ultima
 * palabra entera con "…". Nunca a mitad de palabra.
 */
export function recortarDescripcion(d, max = 170) {
  if (typeof d !== "string" || d.length <= max) return d;
  const tramo = d.slice(0, max);
  let fin = -1;
  for (const m of tramo.matchAll(/[.!?](?=\s|$)/g)) fin = m.index;
  if (fin >= 100) return tramo.slice(0, fin + 1).trim();
  const palabra = tramo.slice(0, max - 1).replace(/\s+\S*$/, "").replace(/[\s,;:\-–—(]+$/, "");
  return palabra + "…";
}

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

// Normaliza el slug antes de entregar (ver limpiarSlug).
items = items.map((it) => {
  if (!it || typeof it !== "object") return it;
  const { valor, nota } = limpiarSlug(it.slug);
  if (nota) console.log(`  ${nota}`);
  return valor === it.slug ? it : { ...it, slug: valor };
});

// Descripcion demasiado larga: se recorta (forma), ver recortarDescripcion.
items = items.map((it) => {
  if (!it || typeof it.description !== "string" || it.description.length <= 170) return it;
  const nueva = recortarDescripcion(it.description);
  console.log(`  ${it.slug}: description ${it.description.length} -> ${nueva.length} caracteres (se recorto)`);
  return { ...it, description: nueva };
});

// verified:true es una afirmacion de fondo: se sostiene con una fuente admitida
// y concreta, y nunca en temas de elenco. Si no se sostiene, se baja a
// verified:false (la pagina queda noindex) en vez de botarla: el modelo
// exagera la etiqueta, pero el contenido sigue siendo honesto.
items = items.map((it) => {
  if (!it || typeof it !== "object" || it.verified !== true) return it;
  const fuentes = Array.isArray(it.sources) ? it.sources : [];
  let motivo = null;
  if (isCastTopic(it)) motivo = "tema de elenco";
  else if (fuentes.length === 0 || !fuentes.every(isAllowedSource)) motivo = "fuente fuera de la lista admitida";
  else if (!fuentes.some(isConcreteSource)) motivo = "las fuentes son solo portadas de sitios";
  if (!motivo) return it;
  console.log(`  ${it.slug}: verified true -> false (${motivo})`);
  return { ...it, verified: false };
});

// Chequeo estructural minimo, no de contenido: eso es trabajo de guard.js.
const conSlug = items.filter((it) => it && typeof it.slug === "string" && it.slug.length > 0);
if (conSlug.length !== items.length) {
  console.error(`✗ ${items.length - conSlug.length} item(s) sin "slug" valido. Se descarta toda la respuesta.`);
  process.exit(1);
}

writeFileSync(outFile, JSON.stringify({ items: conSlug }, null, 2) + "\n");
console.log(`${conSlug.length} item(s) listos para add-pages.js: ${conSlug.map((p) => p.slug).join(", ")}`);
