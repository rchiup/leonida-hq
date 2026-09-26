Convierte la investigación de más abajo en JSON estricto, sin texto antes ni
después, con esta forma exacta:

{"items": [
  {
    "slug": "kebab-case-sin-gta",
    "title": "Title Case in English",
    "description": "Entre 140 y 160 caracteres, en inglés.",
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

Si la investigación no trae nada publicable, responde {"items": []}.
Usa solo URLs que la investigación haya mencionado explícitamente, nunca
inventadas. Máximo 3 items.

INVESTIGACIÓN:
