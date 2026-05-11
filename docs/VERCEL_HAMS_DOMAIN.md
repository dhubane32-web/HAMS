# Vercel: `404: DEPLOYMENT_NOT_FOUND` for `hams.hawanaairways.com`

DNS pointing at Vercel (`cname.vercel-dns.com` or similar) only routes traffic **to Vercel’s edge**. Vercel still needs to know **which project and which deployment** should serve `hams.hawanaairways.com`. Until that mapping exists, you get **`404: DEPLOYMENT_NOT_FOUND`**.

This repo’s HAMS UI is the **Next.js app in `frontend/`** (not the repo root alone). The Vercel project must build **that** directory.

**Automated / agent note:** These steps run in the **Vercel dashboard** (and your browser). This file is the operator checklist; the repo cannot push Vercel settings without your API token.

---

## Final production configuration (HAMS) — operator checklist

Complete in order. Do **not** change DNS or mail records (already correct).

1. Open the **correct** Vercel project — the one linked in **Settings → Git** to the **HAMS** repository (Hawana Airways app), not another site.
2. Go to **Settings → Domains**.
3. **Add** the hostname **`hams.hawanaairways.com`** (enter the host only; do **not** paste `https://` into the domain field — Vercel stores the bare hostname). Assign it to **Production**.
4. Confirm the domain row shows **Production** (not Preview-only). `DEPLOYMENT_NOT_FOUND` often means the hostname is missing here or attached to the wrong project.
5. **Settings → General → Root Directory** → **`frontend`** (exactly). Save.
6. **Settings → Git → Production Branch** → **`main`** (or your real production branch — must match where you merge releases).
7. **Settings → Environment Variables** → scope **Production** — set exactly:

   | Name | Value |
   |------|--------|
   | `NEXT_PUBLIC_API_URL` | `https://api.hawanaairways.com` |
   | `NEXT_PUBLIC_SITE_URL` | `https://hams.hawanaairways.com` |
   | `NEXT_PUBLIC_CANONICAL_HOST` | `hams.hawanaairways.com` |

   No trailing slash on URLs. Redeploy is required after edits.

8. **Deployments** → open the latest **Production** deployment → **⋯ → Redeploy** (or push a commit to the production branch). Required after changing **Root Directory** or env vars.
9. Verify in the dashboard: domain **Valid**, SSL **Issued**; open **Visit** on the production deployment and confirm `/login` loads.
10. **Browser:** `https://hams.hawanaairways.com` and `/login` — no `DEPLOYMENT_NOT_FOUND`; sign in; open **Dashboard** and a second protected route to confirm client routing.

If `hams` appears on **two** projects, remove it from the wrong one (leave it only on the HAMS Next project).

---

## Duplicate domain: `hams.hawanaairways.com` on the wrong Vercel project

Use this when DNS, build, and env vars look fine but you still see **`404: DEPLOYMENT_NOT_FOUND`** — the hostname may be bound to an **old or empty** project while traffic still hits Vercel.

**There is no API in this repo to list your team’s projects; do the following in the Vercel UI (or CLI with your token).**

1. **List projects** — Dashboard → your **Team** → **Projects**. Open every project that could have been used for Hawana / HAMS / a Next trial (including personal **Hobby** if the domain was added there by mistake).
2. **Search the domain** — In each project: **Settings → Domains**. Look for **`hams.hawanaairways.com`** (or a redirect/alias that includes it).
3. **Remove from wrong projects** — On any project that is **not** the real HAMS app (wrong Git repo, wrong Root Directory, legacy prototype), open the domain row → **Remove** / **Delete**. Confirm until **no** incorrect project lists `hams`.
4. **Attach only to HAMS** — On the single correct project (**Settings → Git** = this HAMS repo): **Settings → Domains** → **Add** `hams.hawanaairways.com` → **Production**.
5. **Re-verify project settings** on that same project:
   - **Root Directory** = `frontend`
   - **Production Branch** = `main` (or your chosen production branch)
   - **Environment Variables** → **Production** includes `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CANONICAL_HOST` (see checklist above).
6. **Redeploy Production** — **Deployments** → latest production deployment → **Redeploy** (after domain cleanup so the edge picks up the right mapping).
7. **Confirm** — Open `https://hams.hawanaairways.com/login` in a private window (bypass cache). Expect the login page, not `DEPLOYMENT_NOT_FOUND`.

**Optional (CLI):** With [Vercel CLI](https://vercel.com/docs/cli) logged in, from each linked project directory you can run `vercel domains ls` / inspect; there is no single “search all projects” command in the basic CLI—dashboard search per project remains the reliable method unless you use the Vercel REST API with a token.

---

## 1. Connect the domain to the **correct** project

1. Open [Vercel Dashboard](https://vercel.com/dashboard) and select the **team** that should own production.
2. Find the Git-linked project that deploys **this** HAMS repository (`dhubane32-web/HAMS` or your fork).
   - If you are not sure which project it is, open each candidate → **Settings → Git** and confirm the repository.
3. Open that project → **Settings → Domains**.
4. Click **Add**, enter **`hams.hawanaairways.com`**, choose **Connect to environment: Production** (recommended for this hostname).
5. Save. Vercel will show **Invalid Configuration** until DNS matches; you already fixed DNS, so within a few minutes it should show **Valid**.

**Common mistake:** The domain was added under a **different** Vercel project (e.g. an empty test app, or the public marketing site). Remove `hams.hawanaairways.com` from any project that should not serve HAMS, and add it **only** on the HAMS Next.js project.

---

## 2. Verify a production deployment exists

1. In the same project, open the **Deployments** tab.
2. Confirm there is at least one **Production** deployment with status **Ready** (green).
3. If there are **no** deployments, connect **Git** (**Settings → Git**) to this repo and push to the configured **Production Branch** (usually `main`), or trigger **Redeploy** from the last good build.

`DEPLOYMENT_NOT_FOUND` can appear if the project has **never** had a successful build, or production is broken and no deployment is assigned to Production.

---

## 3. Production branch and monorepo root (`frontend/`)

This repository is a **monorepo** (workspaces: `frontend`, `backend`). Vercel must use the Next.js app root:

1. **Settings → General → Root Directory** → set to **`frontend`** (exact folder name).
2. **Settings → Git → Production Branch** → set to the branch you release from (e.g. **`main`**). Align with your GitHub default branch.
3. Trigger **Redeploy** on the latest commit after changing Root Directory (required).

If Root Directory is wrong (e.g. `.` or empty), Vercel may not detect Next.js correctly or build the wrong tree, and domains may not attach to a valid deployment.

**Install / build (defaults usually work):**

- **Install Command:** `npm install` (runs inside `frontend/` once root is set).
- **Build Command:** `npm run build` (from `frontend/package.json`).
- **Output:** Next.js default (`.next`).

---

## 4. Re-check domain settings in Vercel

| Check | Where |
|--------|--------|
| Domain listed | **Settings → Domains** → `hams.hawanaairways.com` present |
| Environment | Domain assigned to **Production** (unless you intentionally use Preview) |
| Redirects | Avoid duplicate conflicting redirects; Next middleware handles `www`/HTTPS per env |
| Multiple projects | Search other projects (**Settings → Domains**) for `hams` — only **one** project should own it |

---

## 5. SSL provisioning

After the domain shows **Valid** in **Domains**:

- Vercel issues certificates automatically (often within minutes).
- If it stays **Pending**, confirm DNS is exactly what Vercel shows (CNAME target may be project-specific in some setups; prefer the value from the Vercel UI over generic examples).
- Do not use **Cloudflare “orange cloud”** proxy on the same hostname until you understand [SSL modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/); **Full (strict)** is required if proxied.

---

## 6. Confirm the HAMS frontend loads

After Production shows **Ready** and the domain is **Valid**:

1. Open `https://hams.hawanaairways.com/login` — expect the HAMS login page (not `DEPLOYMENT_NOT_FOUND`).
2. In the browser **Network** tab, confirm requests go to **`https://api.hawanaairways.com`** (or your configured `NEXT_PUBLIC_API_URL`) for API calls.
3. Locally you can re-check DNS/TLS with:  
   `bash scripts/verify-hawana-production-dns.sh`

**Production env in Vercel (Project → Settings → Environment Variables → Production):**

| Name | Example |
|------|---------|
| `NEXT_PUBLIC_API_URL` | `https://api.hawanaairways.com` |
| `NEXT_PUBLIC_SITE_URL` | `https://hams.hawanaairways.com` |
| `NEXT_PUBLIC_CANONICAL_HOST` | `hams.hawanaairways.com` |

Redeploy after changing env vars.

---

## Quick checklist

- [ ] Domain `hams.hawanaairways.com` is on the **HAMS** Vercel project (the one with Git → this repo).
- [ ] **Root Directory** = `frontend`.
- [ ] At least one **Production** deployment **Ready**.
- [ ] Domain status **Valid**; SSL issued (no certificate errors).
- [ ] `NEXT_PUBLIC_*` production variables set; redeployed.

If all of the above are true and you still see `DEPLOYMENT_NOT_FOUND`, open a Vercel support ticket with the project ID — edge configuration is on their side.
