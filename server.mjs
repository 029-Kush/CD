import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "./project-store.mjs";

const root = fileURLToPath(new URL("./dist/", import.meta.url));
const port = Number(process.env.PORT || 4173);
const store = await openStore(process.env.CLARITY_DATA_FILE || fileURLToPath(new URL("./data/project.json", import.meta.url)));
const types = {".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8"};
const server = createServer(async (request, response) => {
  const json = (status, value) => { response.writeHead(status, {"Content-Type":"application/json", "Cache-Control":"no-store"}); response.end(JSON.stringify(value)); };
  try {
    const host = request.headers.host;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) return json(403, {error:"Local host required."});
    const origin = request.headers.origin;
    if (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)) return json(403, {error:"Cross-origin access denied."});
    const url = new URL(request.url, `http://${host}`);
    if (url.pathname === "/api/project") {
      if (request.method === "GET") return json(200, store.read());
      if (request.method !== "PUT") return json(405, {error:"Use GET or PUT."});
      if (!request.headers["content-type"]?.startsWith("application/json")) return json(415, {error:"JSON required."});
      let body = "";
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 1000000) return json(413, {error:"Project too large."}); }
      return json(200, await store.update(JSON.parse(body)));
    }
    if (!["GET","HEAD"].includes(request.method)) return json(405, {error:"Method not allowed."});
    const file = resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!file.startsWith(resolve(root) + sep)) return json(403, {error:"Invalid path."});
    const body = await readFile(file);
    response.writeHead(200, {"Content-Type":types[extname(file)] || "application/octet-stream", "Cache-Control":"no-store"});
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    json(error.status || (error.code === "ENOENT" ? 404 : 400), {error:error.message});
  }
});
server.on("error", error => {
  console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use. Stop the previous server with Ctrl+C, then restart.` : error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => console.log(`Clarity + project API running at http://127.0.0.1:${port}`));
