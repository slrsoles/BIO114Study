/* Serverless API for shared, cross-device study progress.
 *
 * Storage: Redis (via Upstash REST). Works with either set of env vars:
 *   - Vercel Marketplace "Upstash" / KV integration:  KV_REST_API_URL  / KV_REST_API_TOKEN
 *   - A standalone Upstash Redis database:             UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *
 * Endpoints (all on /api/progress):
 *   GET  ?list=1            -> { users: ["alice", ...] }
 *   GET  ?user=alice        -> { user, data: {watch,stats} | null }
 *   POST { user, data }     -> { ok: true }
 *
 * Keys used: bio114:users (a set of names), bio114:user:<name> (JSON blob).
 */
var REST_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL   || "";
var REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

async function redis(command) {
  var res = await fetch(REST_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + REST_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  var json = await res.json();
  if (json && json.error) throw new Error(json.error);
  return json ? json.result : null;
}

// Canonical username handle: trim, spaces -> underscore, keep [A-Za-z0-9_], max 24.
// MUST match cleanName() in app.js so client and server agree on keys.
function cleanName(raw) {
  return String(raw == null ? "" : raw)
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "")
    .slice(0, 24);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!REST_URL || !REST_TOKEN) {
    res.status(503).json({ error: "Storage not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN." });
    return;
  }
  try {
    if (req.method === "GET") {
      var q = req.query || {};
      if (q.list) {
        var users = (await redis(["SMEMBERS", "bio114:users"])) || [];
        res.status(200).json({ users: users });
        return;
      }
      var user = cleanName(q.user);
      if (!user) { res.status(400).json({ error: "Missing ?user" }); return; }
      var raw = await redis(["GET", "bio114:user:" + user]);
      var data = null;
      if (raw) { try { data = JSON.parse(raw); } catch (e) { data = null; } }
      res.status(200).json({ user: user, data: data });
      return;
    }

    if (req.method === "POST") {
      var body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      body = body || {};
      var name = cleanName(body.user);
      if (!name) { res.status(400).json({ error: "Missing user" }); return; }
      var blob = body.data && typeof body.data === "object" ? body.data : { watch: {}, stats: {} };
      await redis(["SET", "bio114:user:" + name, JSON.stringify(blob)]);
      await redis(["SADD", "bio114:users", name]);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
