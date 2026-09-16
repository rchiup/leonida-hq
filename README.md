# Leonida HQ — sitio companion de videojuego

Generador estatico sin dependencias. Node 18+. No hay `npm install` que hacer.

## Los tres comandos

```bash
npm run build      # genera dist/
npm run serve      # previsualiza en http://localhost:8080
node import.js vehicles archivo.csv    # carga datos masivos
```

## Como esta armado

```
site.config.json   dominio, fecha de lanzamiento, IDs de AdSense y analitica
data/*.json        los datos. Cada item tiene "verified": true|false
content            data/pages.json — paginas editoriales
lib/html.js        plantilla unica. Todo el SEO vive aca
build.js           generador
import.js          CSV -> miles de paginas
public/            CSS, favicon, countdown
dist/              salida. Esto es lo que se sube
```

## La regla que no se rompe

Todo item lleva `verified`. Si es `false`:

- la pagina se genera igual (para que la veas y la revises)
- sale con `noindex` — Google no la toca
- queda fuera del sitemap
- muestra un aviso visible de dato sin confirmar

Esto existe por una razon: un sitio de datos de juego vive de que sus numeros
sean correctos. Publicar stats inventadas de un juego que no salio te quema la
reputacion y te gana una penalizacion de Google. No lo desactives.

## El dia del lanzamiento

Ese dia aparecen miles de busquedas especificas nuevas que nadie tiene cubiertas.
Ahi es donde se gana, y el flujo es este:

1. Consigues los datos (datamining de la comunidad, wikis abiertas, API si existe)
2. Los pasas a CSV con una columna `Name` y las que tengas
3. `node import.js vehicles datos.csv`
4. `npm run build`
5. Subes

De un CSV de 3.000 filas salen 3.000 paginas con SEO completo. Probado.

## Desplegar

Cloudflare Pages o Netlify, plan gratis, ambos sirven:

- Build command: `npm run build`
- Output directory: `dist`

Conectas el repo de GitHub y cada push publica solo.

## Activar publicidad

En `site.config.json`, cambia `adsense.enabled` a `true` y pega tu client ID y
los slots. Mientras este en `false` se ven recuadros punteados en lugar de avisos.

No postules a AdSense con el sitio vacio: lo rechazan. Espera a tener contenido
real y algo de trafico.
