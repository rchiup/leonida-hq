// Cadena de LLMs gratis para el agente de publicacion.
//
//   node scripts/llm-chain.js
//
// Paso 1 (investigar, con busqueda web) y Paso 2 (estructurar en JSON) se
// hacen probando modelos en el orden de agente/llm-chain.json. Si uno falla
// (cuota diaria, limite por minuto, error del servidor, JSON malo) se pasa al
// siguiente, incluso de otro proveedor. Proveedores sin API key se saltan.
//
// Escribe en $RUNNER_TEMP: investigacion.txt, respuesta-cruda.json, agente-log.txt
// Escribe en $GITHUB_OUTPUT: skip=true|false, modelo_investigacion, modelo_json
//
// Si TODOS los modelos se quedan sin cuota o fallan por motivos transitorios,
// termina en verde con skip=true y un aviso (no es una falla del workflow: no
// hay paginas nuevas y ya). Sale con error solo si una API key es rechazada y
// nada funciono, o si no hay ninguna key configurada.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FAST = process.env.LLM_FAST === "1"; // solo para tests
const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? Math.min(ms, 5) : ms));

const PROVIDERS = {
  groq: { keyEnv: "GROQ_API_KEY", kind: "openai", url: () => "https://api.groq.com/openai/v1/chat/completions" },
  cerebras: { keyEnv: "CEREBRAS_API_KEY", kind: "openai", url: () => "https://api.cerebras.ai/v1/chat/completions" },
  openrouter: { keyEnv: "OPENROUTER_API_KEY", kind: "openai", url: () => "https://openrouter.ai/api/v1/chat/completions" },
  gemini: {
    keyEnv: "GEMINI_API_KEY",
    kind: "gemini",
    url: (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,
  },
};

function endpoint(provider, model) {
  if (process.env.LLM_TEST_BASE) return `${process.env.LLM_TEST_BASE}/${provider}/${model}`;
  return PROVIDERS[provider].url(model);
}

// ---------- clasificacion de errores ----------

export function parseWaitMs(text) {
  const m = /(?:try again in|retry in|retrydelay"?:\s*")\s*(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?/i.exec(text || "");
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000;
}

export function classify(status, bodyText) {
  const t = bodyText || "";
  if (status === 401 || status === 403) return { cls: "auth" };
  if (status === 404) return { cls: "notfound" };
  if (status === 413) return { cls: "toolarge" };
  if (status === 429 || /rate_limit_exceeded|RESOURCE_EXHAUSTED/i.test(t)) {
    if (/per ?day|\(TPD\)|\(RPD\)|daily|PerDay/i.test(t)) return { cls: "quota" };
    return { cls: "rate", waitMs: parseWaitMs(t) };
  }
  if (status === 400 && /output_parse_failed|json_validate_failed/i.test(t)) return { cls: "parse" };
  if (status >= 500) return { cls: "transient" };
  if (status >= 400) return { cls: "badrequest" };
  return { cls: "ok" };
}

// ---------- pedidos por tipo de proveedor ----------

function buildRequest(cand, phase, text) {
  const prov = PROVIDERS[cand.provider];
  if (prov.kind === "gemini") {
    const body = { contents: [{ role: "user", parts: [{ text }] }], generationConfig: { temperature: 1 } };
    if (phase === "research" && cand.search === "google") body.tools = [{ google_search: {} }];
    if (phase === "structure") {
      body.generationConfig.responseMimeType = "application/json";
      body.generationConfig.maxOutputTokens = 8000;
    }
    return { headers: { "x-goog-api-key": process.env[prov.keyEnv] }, body };
  }
  const body = { model: cand.model, messages: [{ role: "user", content: text }] };
  if (cand.reasoning) body.reasoning_effort = cand.reasoning;
  if (phase === "research") {
    if (cand.search === "browser_search") {
      body.tools = [{ type: "browser_search" }];
      body.temperature = 1;
      body.top_p = 1;
    }
  } else {
    if (cand.json !== false) body.response_format = { type: "json_object" };
    if (cand.provider === "groq") body.max_completion_tokens = 6000;
    else body.max_tokens = 6000;
  }
  return { headers: { Authorization: `Bearer ${process.env[prov.keyEnv]}` }, body };
}

function extractText(cand, json) {
  if (PROVIDERS[cand.provider].kind === "gemini") {
    const parts = json?.candidates?.[0]?.content?.parts;
    return Array.isArray(parts) ? parts.map((p) => p.text || "").join("") : "";
  }
  return json?.choices?.[0]?.message?.content || "";
}

export function extraerJSON(texto) {
  let t = String(texto).trim();
  const bloque = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (bloque) t = bloque[1].trim();
  const i = t.indexOf("{");
  const j = t.lastIndexOf("}");
  if (i === -1 || j < i) throw new Error("sin JSON");
  return JSON.parse(t.slice(i, j + 1));
}

// ---------- llamada con reintentos ----------

async function callOnce(cand, phase, text) {
  const { headers, body } = buildRequest(cand, phase, text);
  let res, raw;
  try {
    res = await fetch(endpoint(cand.provider, cand.model), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(phase === "research" ? 240000 : 120000),
    });
    raw = await res.text();
  } catch (e) {
    return { cls: "transient", detail: `red/timeout: ${e.message}` };
  }
  const c = classify(res.status, raw);
  if (c.cls !== "ok") return { ...c, detail: `HTTP ${res.status}: ${raw.replace(/\s+/g, " ").slice(0, 300)}` };
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return { cls: "parse", detail: "respuesta no es JSON" };
  }
  const out = extractText(cand, json);
  if (phase === "research") {
    if (out.trim().length < 80) return { cls: "empty", detail: "respuesta vacia o muy corta" };
    return { cls: "ok", text: out };
  }
  try {
    const obj = extraerJSON(out);
    if (!obj || !Array.isArray(obj.items)) return { cls: "parse", detail: 'el JSON no trae "items"' };
    return { cls: "ok", text: out };
  } catch (e) {
    return { cls: "parse", detail: `JSON invalido: ${e.message}` };
  }
}

/**
 * Prueba los candidatos en orden. Devuelve { ok, text, used, attempts }.
 * attempts: [{ who, cls, detail }] para el log.
 */
export async function runPhase(phase, candidates, text, ctx) {
  const attempts = [];
  const deadProviders = ctx.deadProviders; // compartido entre pasos
  for (const cand of candidates) {
    const who = `${cand.provider}/${cand.model}`;
    if (deadProviders.has(cand.provider) || ctx.deadModels.has(who)) continue;
    if (!process.env[PROVIDERS[cand.provider].keyEnv]) {
      if (!ctx.avisados.has(cand.provider)) {
        ctx.avisados.add(cand.provider);
        attempts.push({ who: cand.provider, cls: "sinkey", detail: `sin ${PROVIDERS[cand.provider].keyEnv}, se salta` });
      }
      continue;
    }
    for (let n = 1; n <= 3; n++) {
      if (Date.now() > ctx.deadline) {
        attempts.push({ who, cls: "deadline", detail: "se acabo el tiempo total de la cadena" });
        return { ok: false, attempts };
      }
      const r = await callOnce(cand, phase, text);
      if (r.cls === "ok") {
        attempts.push({ who, cls: "ok", detail: "" });
        return { ok: true, text: r.text, used: cand, attempts };
      }
      attempts.push({ who, cls: r.cls, detail: r.detail });
      if (r.cls === "auth") {
        deadProviders.add(cand.provider);
        break;
      }
      if (r.cls === "quota" || r.cls === "notfound") {
        ctx.deadModels.add(who); // no insistir con este modelo en el otro paso
        break;
      }
      if (r.cls === "rate") {
        const w = r.waitMs ?? 20000;
        // Gemini responde 429 "exceeded your current quota" tanto por minuto como cuando el plan gratis no incluye la funcion (p.ej. busqueda con Google): un solo reintento alcanza.
        if (w > 90000 || n >= (cand.provider === "gemini" ? 2 : 3)) break;
        await sleep(w + 1500);
        continue;
      }
      if (r.cls === "parse" || r.cls === "empty") {
        if (n === 3) break;
        await sleep(3000);
        continue;
      }
      if (r.cls === "transient") {
        if (n >= 2) break;
        await sleep(10000);
        continue;
      }
      break; // quota, notfound, toolarge, badrequest: siguiente modelo
    }
  }
  return { ok: false, attempts };
}

// ---------- armado de mensajes y config ----------

function inferir(model, phase) {
  const provider = /^gemini/.test(model) ? "gemini" : "groq";
  if (phase === "structure") return { provider, model, reasoning: /gpt-oss/.test(model) ? "low" : undefined };
  if (/^gemini/.test(model)) return { provider, model, search: "google" };
  if (/compound/.test(model)) return { provider, model, search: "builtin" };
  return { provider, model, search: "browser_search", reasoning: "low" };
}

export function aplicarOverride(lista, modelo, phase) {
  if (!modelo) return lista;
  const i = lista.findIndex((c) => c.model === modelo);
  const cand = i >= 0 ? lista[i] : inferir(modelo, phase);
  return [cand, ...lista.filter((_, k) => k !== i)];
}

export function construirMensajePaso1(base, pages, hoy) {
  const slugs = pages.map((p) => `${p.slug} — ${p.title}`).join("\n");
  return (
    base +
    "\n\nFecha de hoy: " + hoy +
    "\n\nPáginas ya publicadas (slug — título). No repitas estos temas ni propongas variantes:\n" + slugs +
    "\n\nHaz el Paso 1 ahora: investiga y escribe tus hallazgos en texto, con URLs completas."
  );
}

function fmt(attempts) {
  return attempts.map((a) => `- ${a.who}: ${a.cls}${a.detail ? " — " + a.detail : ""}`).join("\n");
}

function setOutput(k, v) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
}
function summary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
}

// ---------- main ----------

async function main() {
  const tmp = process.env.RUNNER_TEMP || ".";
  const cfg = JSON.parse(readFileSync("agente/llm-chain.json", "utf8"));
  const modelo = (process.env.MODELO || "").trim();
  const defecto = cfg.research[0].model;
  const pref = modelo && modelo !== defecto ? modelo : "";
  const research = aplicarOverride(cfg.research, pref, "research");
  const structure = aplicarOverride(cfg.structure, pref, "structure");

  const keys = Object.values(PROVIDERS).filter((p) => process.env[p.keyEnv]).length;
  if (!keys) {
    console.error("::error::No hay ninguna API key configurada (GROQ_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY).");
    process.exit(1);
  }

  const ctx = { deadline: Date.now() + 14 * 60 * 1000, avisados: new Set(), deadProviders: new Set(), deadModels: new Set() };
  const pages = JSON.parse(readFileSync("data/pages.json", "utf8")).items;
  const hoy = new Date().toISOString().slice(0, 10);
  const msg1 = construirMensajePaso1(readFileSync("agente/PROMPT-groq.md", "utf8"), pages, hoy);

  const fallar = (etapa, attempts) => {
    const log = `===== ${etapa}: todos los modelos fallaron =====\n${fmt(attempts)}\n`;
    writeFileSync(`${tmp}/agente-log.txt`, log);
    console.log(log);
    setOutput("skip", "true");
    const auth = attempts.some((a) => a.cls === "auth");
    summary(`### ⚠️ Sin páginas nuevas (${etapa})\nNingún modelo gratis pudo responder. Probablemente es cuota diaria agotada; se reintenta en la próxima corrida.\n\n${fmt(attempts)}`);
    if (auth) {
      console.error("::error::Una API key fue rechazada (401/403) y ningun otro modelo respondio. Revisa los secrets.");
      process.exit(1);
    }
    console.log("::warning::Sin cuota o sin respuesta en todos los modelos. Corrida verde, sin paginas nuevas.");
    process.exit(0);
  };

  // Paso 1
  console.log("== Paso 1: investigar ==");
  const r1 = await runPhase("research", research, msg1, ctx);
  console.log(fmt(r1.attempts));
  if (!r1.ok) return fallar("paso 1 — investigar", r1.attempts);
  writeFileSync(`${tmp}/investigacion.txt`, r1.text);
  const m1 = `${r1.used.provider}/${r1.used.model}`;

  // Si el paso 2 va a usar el mismo modelo de Groq, la ventana de tokens por
  // minuto sigue casi llena por la busqueda: esperar ~1 minuto.
  const primero = structure.find(
    (c) => process.env[PROVIDERS[c.provider].keyEnv] && !ctx.deadProviders.has(c.provider) && !ctx.deadModels.has(`${c.provider}/${c.model}`)
  );
  if (primero && `${primero.provider}/${primero.model}` === m1 && primero.provider === "groq") {
    console.log("Mismo modelo de Groq en el paso 2, esperando 50s por el limite por minuto...");
    await sleep(50000);
  }

  // Paso 2
  console.log("== Paso 2: estructurar en JSON ==");
  const msg2 = readFileSync("agente/JSON-SCHEMA-groq.md", "utf8") + "\n" + r1.text;
  const r2 = await runPhase("structure", structure, msg2, ctx);
  console.log(fmt(r2.attempts));
  if (!r2.ok) return fallar("paso 2 — estructurar", [...r1.attempts, ...r2.attempts]);
  writeFileSync(`${tmp}/respuesta-cruda.json`, r2.text);
  const m2 = `${r2.used.provider}/${r2.used.model}`;

  writeFileSync(
    `${tmp}/agente-log.txt`,
    `===== CADENA =====\npaso 1: ${m1}\npaso 2: ${m2}\n\nIntentos:\n${fmt([...r1.attempts, ...r2.attempts])}\n\n===== PASO 1: investigación =====\n${r1.text}\n\n===== PASO 2: JSON propuesto =====\n${r2.text}\n`
  );
  setOutput("skip", "false");
  setOutput("modelo_investigacion", m1);
  setOutput("modelo_json", m2);
  const fallbacks = [...r1.attempts, ...r2.attempts].filter((a) => a.cls !== "ok" && a.cls !== "sinkey");
  summary(`### Modelos usados\n- Investigación: \`${m1}\`\n- JSON: \`${m2}\`` + (fallbacks.length ? `\n\n**Fallbacks que hubo que saltar:**\n${fmt(fallbacks)}` : ""));
  if (fallbacks.length) console.log(`::notice::Se usaron fallbacks (${fallbacks.length} intentos fallidos). Ver resumen.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error("::error::" + (e && e.stack ? e.stack : e));
    process.exit(1);
  });
}
