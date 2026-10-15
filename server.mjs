import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./dist/", import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json" };

createServer(async (request, response) => {
  try {
    const requested = request.url === "/" ? "index.html" : request.url.split("?")[0].replace(/^\//, "");
    const safe = normalize(requested).replace(/^(\.\.[/\\])+/, "");
    const body = await readFile(join(root, safe));
    response.writeHead(200, { "Content-Type": types[extname(safe)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Compiler demo running at http://127.0.0.1:${port}`);
});
