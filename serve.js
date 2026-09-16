// Previsualizacion local: node serve.js  ->  http://localhost:8080
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain" };

createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let file = join("dist", p);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) file = join("dist", "404.html");
  res.writeHead(existsSync(join("dist", p)) ? 200 : 404,
    { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(8080, () => console.log("http://localhost:8080"));
