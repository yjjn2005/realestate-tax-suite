// Cloudflare Worker — 부동산세금계산기(realestate-tax-suite) PIN 동기화 API
// KV 바인딩: RETAX_SYNC
const H = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: H });
    if (u.pathname !== "/sync") {
      return new Response(JSON.stringify({ ok: true, app: "realestate-tax-suite" }), { headers: H });
    }
    const key = u.searchParams.get("key") || "";
    if (!/^[a-f0-9]{64}$/.test(key)) {
      return new Response(JSON.stringify({ error: "bad key" }), { status: 400, headers: H });
    }
    if (req.method === "GET") {
      const v = await env.RETAX_SYNC.get(key);
      return v
        ? new Response(v, { headers: H })
        : new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: H });
    }
    if (req.method === "PUT") {
      const body = await req.text();
      if (body.length > 200000) {
        return new Response(JSON.stringify({ error: "too large" }), { status: 413, headers: H });
      }
      try {
        const j = JSON.parse(body);
        if (typeof j !== "object" || j === null) throw 0;
      } catch {
        return new Response(JSON.stringify({ error: "bad body" }), { status: 400, headers: H });
      }
      await env.RETAX_SYNC.put(key, body);
      return new Response(JSON.stringify({ ok: true }), { headers: H });
    }
    return new Response(JSON.stringify({ error: "method" }), { status: 405, headers: H });
  }
};
