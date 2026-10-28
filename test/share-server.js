// A local NODE share server for tests: the real Worker (worker/src/index.js)
// with an in-memory bucket, over plain HTTP.
//   node test/share-server.js [port]     (default 8790)
const http = require("http");

function memoryBucket() {
  const items = new Map();
  return {
    items,
    async put(key, body, opts) { items.set(key, { bytes: new Uint8Array(body), customMetadata: { ...opts.customMetadata } }); },
    async get(key) {
      const it = items.get(key);
      if (!it) return null;
      return { customMetadata: it.customMetadata, body: new Blob([it.bytes]).stream(), arrayBuffer: async () => it.bytes.slice().buffer };
    },
    async delete(key) { items.delete(key); },
  };
}

async function start(port = 8790) {
  const { default: worker } = await import("../worker/src/index.js");
  const env = { TRAILS: memoryBucket() };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
    const r = await worker.fetch(request, env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(port, "127.0.0.1", ok));
  return { server, env, url: `http://127.0.0.1:${port}` };
}

module.exports = { start };
if (require.main === module) start(Number(process.argv[2]) || 8790).then((s) => console.log("share server on", s.url));
