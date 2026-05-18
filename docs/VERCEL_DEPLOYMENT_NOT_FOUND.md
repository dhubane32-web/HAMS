# Recover from `404 DEPLOYMENT_NOT_FOUND` on `hams.hawanaairways.com`

DNS can show **Valid** while Vercel returns **`DEPLOYMENT_NOT_FOUND`** if the hostname is not bound to a **current, successful Production deployment** (project deleted, never deployed, domain left orphaned, or domain still on another project).

**This repository cannot create Vercel projects or attach domains.** Complete the steps below in the Vercel UI (team **`dhubane32-web`** or wherever you deploy).

---

## A. Fresh project (recommended when the old project is inaccessible)

1. **Vercel → Add New → Project** → Import **`dhubane32-web/HAMS`**.
2. **Configure**
   - **Root Directory:** `frontend`
   - **Framework:** Next.js  
   - **Production Branch:** `main`
3. **Environment variables → Production**

   | Name | Value |
   |------|--------|
   | `NEXT_PUBLIC_API_URL` | `https://api.hawanaairways.com` |
   | `NEXT_PUBLIC_SITE_URL` | `https://hams.hawanaairways.com` |
   | `NEXT_PUBLIC_CANONICAL_HOST` | `hams.hawanaairways.com` |

4. **Deploy** — wait until status **Ready**. Fix any errors in **Build Logs** (missing `frontend`, wrong Node version, etc.).
5. **Settings → Domains** → add **`hams.hawanaairways.com`** → **Production**.
6. If Vercel says **domain already in use:** remove **`hams.hawanaairways.com`** from **every other** project/team, then add it again on this project.
7. **Redeploy** with **Clear build cache** after domain or env changes.
8. Verify **`https://hams.hawanaairways.com/login`** (private window).

---

## B. “Domain connected but deployment missing”

Usually means the **project** that used to serve the domain was **removed** or **never had a successful Production build**, while DNS still points at Vercel.

- Re-import the repo (section A), **or**  
- On an existing empty project: connect Git, set **Root Directory = `frontend`**, run a successful deploy, then attach **`hams.hawanaairways.com`**.

---

## C. Do not change Namecheap

If **`hams` → `cname.vercel-dns.com`** is already set, **leave DNS**; only Vercel project + domain + successful deploy must align.

---

## D. Production vs localhost

Set **`NEXT_PUBLIC_API_URL`** in Vercel so the browser calls the real API. The app defaults production API to `https://api.hawanaairways.com` only when that variable is unset (see `frontend/lib/api-base.ts`); you should still set it explicitly.

---

## E. Reference

- Full Vercel + DNS notes: **`docs/VERCEL_HAMS_DOMAIN.md`**
- Architecture / API / `FRONTEND_URL`: **`docs/PRODUCTION_HAWANA_AIRWAYS.md`**
