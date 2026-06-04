# BIO 114 — California Plants Study Guide

An interactive study site for the 41 dune / marsh / woodland species from the class Quizlet set.
Static front end (no build step) plus one serverless API for shared, cross-device progress.

## Features

- **Practice by type** (6 modes): scientific→common, common→scientific, names→photo, photo→type common, photo→type scientific, photo→plant community.
- **Simulate Exam** — 20 questions across all four question types, fresh plants and answer choices every run.
  - *Easy*: multiple choice.
  - *Hard*: type every answer. Accepts ~80% spelling accuracy, plus a **"that was a typo — count it correct"** button.
- **Watchlist** — miss a plant and it's added automatically; answer it correctly 3 times to clear it (a wrong answer resets its progress). Includes a "practice the watchlist" quiz.
- **Notecards** (classic flip cards): *Common ⟷ Scientific*, and *Names ⟷ Description* (the back shows the full
  field-guide write-up — habit, community, ID, role — sourced from the BIO 114 Field Trip Plant Notebook).
- **Usernames + saved progress** — pick or create a profile on entry. Each profile keeps its own watchlist,
  per-plant mastery, answer log, and session history, synced to the cloud so you resume on any device.
- **Progress screen** — overall accuracy, simulate bests, plants seen, a "needs work" list, and recent sessions.
- **Multiple-choice options are fully re-randomized on every question render.**

## Project layout

```
index.html        Markup / shell
styles.css        Styles
app.js            All app logic (vanilla JS, no dependencies)
data.js           window.PLANTS — the 41 plants (Monterey cypress & bulrush photos embedded)
plants.csv        The same data as a spreadsheet
assets/           The two locally-hosted photos
api/progress.js   Serverless function for shared progress (Redis via Upstash/Vercel KV)
```

## Run locally

Open `index.html` in a browser — everything works **except** cloud sync (progress falls back to this
browser's local storage). To exercise the cloud API locally, install the Vercel CLI and run `vercel dev`.

## Deploy to Vercel (via GitHub)

1. **Push this folder** to the repo (see commands below).
2. On **vercel.com → Add New → Project**, import `slrsoles/BIO114Study`. Framework preset: **Other**
   (no build command, output is the repo root). Deploy. The site is live as a static site + `/api`.

## Turn on the shared database (cross-device progress)

The site works without this (local-only). For shared usernames/progress across devices, add a Redis store:

**Option A — Vercel Marketplace (simplest):** Project → **Storage** → add **Upstash** (Redis). Vercel
injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Redeploy.

**Option B — standalone Upstash:** create a free database at upstash.com, copy its **REST URL** and
**REST token**, and add them to Vercel → Project → **Settings → Environment Variables** as
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Redeploy.

`api/progress.js` reads either pair of variables. No code changes needed.

## Password-protect the site (Shopify-style, edge-enforced)

Set one env var in Vercel to lock the whole site:

- `SITE_PASSWORD` = the shared password (remove it to disable the gate).

How it works (real server-side protection, not a client overlay):

- **`middleware.js`** (Vercel Edge Middleware) runs on **every** request. Without a valid auth cookie it
  redirects page requests to `/gate.html` and returns `401` for `/api/*` — so unauthenticated visitors never
  receive `index.html`, `app.js`, `data.js`, the images, or anything else. The protected bytes are never sent.
- **`/gate.html`** is the standalone password page the edge serves to unauthenticated visitors.
- **`api/gate.js`** verifies the password and sets a **signed, HttpOnly cookie** (an HMAC token, key derived
  from `SITE_PASSWORD`). The middleware verifies that token statelessly at the edge — no per-request DB lookup.
- The cookie lasts 30 days (per browser). As a convenience, the first correct entry also records the **network
  (IP)** in Redis (hashed, 30-day TTL), so a new device on the same network is auto-issued a cookie without
  retyping ("once per network"). Needs the same Redis env vars as the progress sync.

This is the same model as Shopify's storefront password: enforcement happens before any content is served.
If `SITE_PASSWORD` is unset, the gate is disabled and the site is fully open.

## Data notes

- Most plant photos are **sourced from [Calflora](https://www.calflora.org)** and bundled in `assets/` (named `cf_*.jpg`);
  Monterey cypress and bulrush use separately-provided images; a few remaining plants still load from Quizlet's CDN.
  Each card shows its photo source, and `plants.csv` has a `photo_credit` column.
- A few names carry the original set's spelling quirks (e.g. *Croton califonicus*, *Pinus sabina*); answers
  match the set, and typed checking is lenient.
- Built from the Quizlet set; verified with automated tests (`test_site.js`, `test_api.js`, `test_cloud.js`
  in the build workspace).
