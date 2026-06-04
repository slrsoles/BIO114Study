/* Vercel Edge Middleware — enforces the password gate BEFORE any byte is served.
 *
 * Runs on every request (except the gate page + auth API + analytics). If SITE_PASSWORD is set
 * and the request lacks a valid signed auth cookie, the request is redirected to /gate.html
 * (or 401 for /api/*) — so unauthenticated visitors never receive index.html, app.js, data.js,
 * the images, anything. This is the "Shopify-style" model: protection at the server/edge, not the client.
 *
 * The cookie is a stateless HMAC token (exp.signature) signed by /api/gate with the same secret,
 * so verification here needs no database lookup. Uses only Web-standard APIs (no dependencies).
 */
export const config = {
  // gate everything EXCEPT the password page, the auth endpoint, analytics, and favicon
  matcher: ['/((?!api/gate|gate.html|favicon.ico|_vercel/).*)'],
};

const COOKIE = "bio114_auth";

function getCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  const m = raw.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
function b64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmac(message, key) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return b64url(new Uint8Array(sig));
}
async function validToken(token, password) {
  if (!token) return false;
  const i = token.indexOf(".");
  if (i < 0) return false;
  const exp = token.slice(0, i), sig = token.slice(i + 1);
  if (!/^\d+$/.test(exp) || parseInt(exp, 10) < Date.now()) return false;       // expired
  const expected = await hmac(exp, password + "|bio114");                        // same key as /api/gate
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let j = 0; j < sig.length; j++) diff |= sig.charCodeAt(j) ^ expected.charCodeAt(j);
  return diff === 0;
}

export default async function middleware(req) {
  const password = process.env.SITE_PASSWORD || process.env.GATE_PASSWORD || "";
  if (!password) return; // gate disabled -> allow everything through

  const token = getCookie(req, COOKIE);
  if (await validToken(token, password)) return; // valid cookie -> allow

  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }
  return Response.redirect(new URL("/gate.html", req.url), 302);
}
