IDIOMA (obligatorio): TODO el texto del JSON va en inglés — title, description
y cada "h" y "p" de todas las secciones. La investigación de más abajo está en
español: tradúcela. Una sola frase en español hace que la página sea rechazada.

Convierte la investigación de más abajo en JSON estricto, sin texto antes ni
después, con esta forma exacta:

{"items": [
  {
    "slug": "kebab-case-sin-gta",
    "title": "Title Case in English",
    "description": "In English. Aim for about 150 characters (max 170).",
    "verified": true,
    "sources": ["https://url-completa-y-real-1", "https://url-completa-y-real-2"],
    "sections": [
      {"h": "The short answer", "p": "..."},
      {"h": "What Rockstar/Take-Two said", "p": "..."},
      {"h": "What others said", "p": "..."},
      {"h": "What is still unconfirmed", "p": "..."}
    ]
  }
]}

Extensión: entre las 4 secciones deben sumar al menos ~300 palabras (70-100 por
sección, en prosa, con fechas, cifras y quién lo dijo). Menos de 250 palabras se
rechaza. No rellenes con frases repetidas: si no hay material, devuelve
{"items": []}.

Si la investigación no trae nada publicable, responde {"items": []}.
Usa solo URLs que la investigación haya mencionado explícitamente, nunca
inventadas. Máximo 3 items.

"verified": true SOLO si TODAS las sources son de estos dominios: rockstargames.com,
take2games.com, ign.com, eurogamer.net, gamespot.com, pcgamer.com, gamesradar.com,
kotaku.com, forbes.com, variety.com, billboard.com, bloomberg.com,
dazeddigital.com o taketwointeractivesoftwareinc.gcs-web.com. Si una sola
fuente es de otro sitio, pon "verified": false.

INVESTIGACIÓN:
