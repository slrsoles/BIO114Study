/* Password gate (Shopify-style) with per-IP memory.
 *
 * Set SITE_PASSWORD (or GATE_PASSWORD) in the Vercel project env to enable the gate.
 * If no password is set, the gate is disabled and the site is open.
 *
 * Authorized IPs are remembered in Redis (Upstash/Vercel KV), stored as a salted hash with a TTL,
 * so a given network only enters the password once. Uses the same KV env vars as /api/progress.
 *
 *   GET  ?check=1        -> { enabled, authorized }
 *   POST { password }    -> { enabled, authorized }   (200 if ok, 401 if wrong)
 */
var crypto = require("crypto");
var REST_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL   || "";
var REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
var PASSWORD   = process.env.SITE_PASSWORD || process.env.GATE_PASSWORD || "";
var TTL_SECONDS = 60 * 60 * 24 * 30; // remember an IP for 30 days

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

function clientIp(req) {
  var xff = req.headers["x-forwarded-for"] || "";
  if (Array.isArray(xff)) xff = xff[0] || "";
  var ip = String(xff).split(",")[0].trim();
  return ip || req.headers["x-real-ip"] || (req.socket && req.socket.remoteAddress) || "unknown";
}
function ipKey(ip) {
  // store a salted hash, never the raw IP
  return "bio114:gate:" + crypto.createHash("sha256").update(ip + "|" + PASSWORD).digest("hex").slice(0, 32);
}
function samePassword(a, b) {
  var ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (e) { return false; }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  var enabled = !!PASSWORD;
  if (!enabled) { res.status(200).json({ enabled: false, authorized: true }); return; }

  var ip = clientIp(req);
  try {
    if (req.method === "GET") {
      var authed = false;
      if (REST_URL && REST_TOKEN) {
        var v = await redis(["GET", ipKey(ip)]);
        authed = !!v;
      }
      res.status(200).json({ enabled: true, authorized: authed });
      return;
    }
    if (req.method === "POST") {
      var body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      body = body || {};
      var ok = samePassword(body.password || "", PASSWORD);
      if (ok && REST_URL && REST_TOKEN) {
        await redis(["SET", ipKey(ip), "1", "EX", String(TTL_SECONDS)]);
      }
      res.status(ok ? 200 : 401).json({ enabled: true, authorized: ok });
      return;
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
