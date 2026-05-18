# Vercel: `404: DEPLOYMENT_NOT_FOUND` for `hams.hawanaairways.com`

DNS pointing at Vercel (`cname.vercel-dns.com` or similar) only routes traffic **to Vercel’s edge**. Vercel still needs to know **which project and which deployment** should serve `hams.hawanaairways.com`. Until that mapping exists, you get **`404: DEPLOYMENT_NOT_FOUND`**.

This repo’s HAMS UI is the **Next.js app in `frontend/`** (not the repo root alone). The Vercel project must build **that** directory.

**Automated / agent note:** These steps run in the **Vercel dashboard** (and your browser). This file is the operator checklist; the repo cannot push Vercel settings without your API token.

---

## Wrong Vercel account or team (dashboard is “empty” but DNS hits Vercel)

Symptoms: You log into Vercel as user/team **`dhubane32-web`** (or similar) and **see no HAMS project**, while **`hams.hawanaairways.com`** still returns **`404: DEPLOYMENT_NOT_FOUND`**. DNS correctly points to **`cname.vercel-dns.com`**, so **some other Vercel scope** (another email login, **Hobby** personal account, or a **different team**) still owns the domain attachment or an old deployment.

**What to do:**

1. **Find who owns the Git ↔ Vercel link** — In **GitHub** → repo **Settings** → **GitHub Apps** (or **Integrations**) → **Vercel**. The installation often shows **which Vercel account or team** receives deployments. Open that exact scope in Vercel (you may need to **switch team** in the Vercel header or log in with the **GitHub user** that installed the app).
2. **Try other logins** — Sign out of Vercel; sign in with **every** Google/GitHub/email your org used for Hawana. Check **Hobby** (personal) vs **Pro/team** for a stray **HAMS** or **hawana** project.
3. **Ask teammates** — Who created the first Vercel deploy? They can open **Settings → Domains** on the real project and either **transfer the project** to the correct team (**Settings → General → Transfer**) or **remove** `hams` from the old project so you can attach it on **`dhubane32-web`** after **importing** the repo there.
4. **If the project truly only exists on the wrong account** — On the **account that has the project**: remove duplicate domains (step 4–5 in the checklist below), **or** transfer the project. On **`dhubane32-web`**: **Add New… → Project** → import **`dhubane32-web/HAMS`**, set **Root Directory** `frontend`, then **Domains** → add `hams.hawanaairways.com` (you must **remove** it from the old Vercel scope first if Vercel reports “already exists”).
5. **Never change** Namecheap **MX** / mail records for this; only Vercel project/domain mapping.

---

## Invite `dhubane32-web` to the team that already has HAMS (fastest fix)

You are logged into Vercel as **`dhubane32-web`** but the **HAMS production project lives on another team** (or another user’s scope). Someone who **can already open that project** must add you.

**Steps (owner / admin on the real team):**

1. Vercel → switch to the **team** that contains the HAMS project (top-left team switcher).
2. **Settings** (team) → **Members** → **Invite** → enter the **email** tied to `dhubane32-web` (or the member’s Vercel username if prompted).
3. Grant at least **Developer** (or **Owner** if they should manage production). **Save** / send invite.
4. On **`dhubane32-web`**: open the invite email → **Accept** → in Vercel, **switch team** to the invited team → open the **HAMS** project.

**Then verify and redeploy (any member with access):**

| Check | Where |
|--------|--------|
| Production deployment exists | **Deployments** → latest **Production** = **Ready** |
| Root Directory | **Settings → General** → `frontend` |
| Framework | **Next.js** |
| Production Branch | **Settings → Git** → `main` |
| Env vars | **Settings → Environment Variables** → **Production** → `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CANONICAL_HOST` |
| Redeploy | **Deployments** → **⋯** → **Redeploy** → enable **Clear build cache** |

**Alternative:** **Transfer project** to the `dhubane32-web` team — on the project that has HAMS: **Settings → General → Transfer Project** (requires appropriate role on both sides). DNS stays as-is.

This repository and its agents **cannot** send Vercel invites or click Redeploy; only a human with access to the owning team can.

---

## Option A vs Option B (`dhubane32-web` is empty — no HAMS project)

**Do not change Namecheap DNS** — the **CNAME** `hams` → `cname.vercel-dns.com` is already correct. Only Vercel account / project / domain attachment remains.

### OPTION A (preferred) — Use the original Vercel account that already has HAMS

1. Log into the **original** Vercel **account or team** where the HAMS project was first created (use GitHub **Settings → Integrations → Vercel** on the repo to see which installation/team is linked; try other Google/GitHub logins or the team switcher in Vercel).
2. Open the **HAMS production** project.
3. **Settings → Domains** → confirm **`hams.hawanaairways.com`** is attached to **this** project (Production), status **Valid**.
4. If it is missing, **Add** it (hostname only). If it is on a wrong project in this same account, **remove** duplicates first.
5. **Deployments** → **Redeploy** the latest **Production** deployment.
6. Verify **`https://hams.hawanaairways.com/login`** (incognito): HAMS login, SSL, no `DEPLOYMENT_NOT_FOUND`.

### OPTION B — Clean production on `dhubane32-web` (no access to original Vercel team)

Use when the **original Vercel project cannot be accessed**. DNS at Namecheap can stay as **`hams` → `cname.vercel-dns.com`**; you only reattach the hostname to the **new** project.

**0. Domain lock (if needed)**  
If Vercel says **`hams.hawanaairways.com` is already assigned**, someone must **remove** it from the old project (any old team), or you wait until it is released. You cannot attach one hostname to two projects.

**1. Import GitHub repo into the current Vercel team**

- Vercel (team **`dhubane32-web`** or your active scope) → **Add New… → Project** → **Import** the repo.  
- Canonical clone remote in this repo: **`https://github.com/dhubane32-web/HAMS.git`** → **`dhubane32-web/HAMS`**. Use your fork URL instead if production tracks a fork.

**2. Project settings (before or right after first import)**

| Setting | Value |
|---------|--------|
| **Root Directory** | `frontend` |
| **Framework** | Next.js |
| **Production Branch** | `main` (or the branch you actually ship) |
| **Build Command** | `npm run build` (default; see `frontend/vercel.json`) |
| **Install Command** | `npm install` (default in `frontend/`) |

**3. Environment variables — Production**

Required for the HAMS **frontend** build/runtime:

| Name | Value |
|------|--------|
| `NEXT_PUBLIC_API_URL` | `https://api.hawanaairways.com` |
| `NEXT_PUBLIC_SITE_URL` | `https://hams.hawanaairways.com` |
| `NEXT_PUBLIC_CANONICAL_HOST` | `hams.hawanaairways.com` |

No trailing slash on the two URLs. Redeploy after any change.

*(Backend/API is a separate Vercel project or VPS; `FRONTEND_URL` and DB secrets live on the **API** host — see `docs/PRODUCTION_HAWANA_AIRWAYS.md`.)*

**4. First production deploy**

- Trigger deploy; on **Redeploy**, enable **Clear build cache** so Tailwind/Next don’t reuse a bad cache.  
- Wait until **Production** = **Ready**; open **Build Logs** if it fails.

**5. Domain + SSL + smoke test**

- **Settings → Domains** → add **`hams.hawanaairways.com`** → **Production** → wait for **Valid** (SSL issued by Vercel).  
- Browser **Network**: `/_next/static/css/*.css` and main **chunks** → **200** (not 302 to `/login`).  
- **`https://hams.hawanaairways.com/login`** and a post-login **dashboard** route in a **private window**.

**6. If styling looks wrong**

- Confirm **Root Directory** is really **`frontend`** (wrong root purges Tailwind; this repo’s `tailwind.config.js` also lists `./frontend/**` to reduce that risk).  
- **Redeploy** again with **Clear build cache**.

This repository cannot click Vercel for you; follow the steps above on **`dhubane32-web`**.

---

## Namecheap DNS + Vercel (CNAME already set)

When **Namecheap** (or your registrar) has:

| Type | Host | Value |
|------|------|--------|
| **CNAME** | `hams` | `cname.vercel-dns.com` |

traffic reaches Vercel, but **`404: DEPLOYMENT_NOT_FOUND`** means the hostname is not (or not only) attached to the **official HAMS production** Vercel project. **Do not** change **MX** or other mail rows, or unrelated website DNS — fix **Vercel → Domains** only.

---

## Final 10-step checklist (DNS OK — fix Vercel only)

Use when DNS and `cname.vercel-dns.com` are correct, the **Git build succeeds**, env vars exist, but the browser still shows **`404: DEPLOYMENT_NOT_FOUND`**. Complete in order in the **Vercel dashboard** (this cannot be done from the HAMS repo alone).

1. Open the **correct** Hawana Airways **HAMS production** Vercel project — **Settings → Git** must show this HAMS repository (not another app or fork you do not deploy).
2. Go to **Settings → Domains**.
3. **Add** **`hams.hawanaairways.com`** (hostname only; assign to **Production**).
4. **If Vercel says the domain already exists:** search **all** projects on the team (and **Hobby** if applicable). On each: **Settings → Domains** — remove **`hams.hawanaairways.com`** from any **old / test / preview** project. Then return to step 2–3 on the **official** HAMS project and add it again.
5. **`hams.hawanaairways.com` must be attached ONLY** to the official Hawana Airways HAMS production project (nowhere else).
6. In **Domains**, confirm **Domain status = Valid** (and SSL issued by Vercel for that hostname).
7. Open **Deployments**.
8. **Redeploy** the **latest Production** deployment (⋯ menu → **Redeploy**). Wait until **Ready**.
9. **Settings** cross-check: **Root Directory** = **`frontend`**, **Framework** = **Next.js**, **Git → Production Branch** = **`main`** (or your real production branch).
10. Test **`https://hams.hawanaairways.com/login`** (private/incognito): **HAMS login** loads, **SSL** active, **no** `DEPLOYMENT_NOT_FOUND`, production online.

If the error persists after step 4–5, confirm a **Production** deployment is **Ready** (not skipped — check build logs for “Ignored Build Step”) and that **Environment Variables** for **Production** include `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, and `NEXT_PUBLIC_CANONICAL_HOST` (see table under [Quick checklist](#quick-checklist) below).

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

---

## `ERR_CONNECTION_CLOSED` (after `DEPLOYMENT_NOT_FOUND` is fixed)

The browser reaches Vercel, but the connection drops before a normal HTTP response. **Do not change Namecheap DNS.** Work through Vercel and this repo.

### Fixes applied in this repository

| Area | Change |
|------|--------|
| **`next/image` + `.svg`** | Local decorative SVGs (`/login-aircraft.svg`, `/admin-avatar.svg`) use **`unoptimized`** so Vercel’s image pipeline does not break on SVG optimization. |
| **Middleware** | HTTPS-from-`x-forwarded-proto` redirect is **skipped when `VERCEL=1`**, avoiding edge/proto edge cases. |
| **Node** | `frontend/package.json` declares **`engines.node`** — in Vercel **Settings → General → Node.js Version**, use **20.x** (or satisfy `engines`). |

### Operator checklist (matches production triage)

1. **Deployment status** — **Production** latest = **Ready**; **Build Logs** clean; **Runtime / Function / Edge** logs when reproducing `/login` (look for stack traces, OOM, timeouts).
2. **Root Directory** = `frontend`.
3. **Framework** = Next.js.
4. **Build command** = `npm run build` (default; `frontend/vercel.json` mirrors this).
5. **Output** — default Next.js on Vercel (no custom `output` required for App Router).
6. **Environment variables (Production)** — `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CANONICAL_HOST` (login page renders without API, but API must work for sign-in).
7. **Domains** — `hams.hawanaairways.com` = **Valid**, SSL issued.
8. **API** — e.g. `curl -sSI --max-time 15 https://api.hawanaairways.com/health` → **200** (CORS/backend down does not usually cause **connection closed** on the HTML request).
9. **Logs** — Build, Runtime, Functions, Edge in the deployment that serves Production.
10. **Redeploy** Production after pulling the latest commit (SVG / middleware fixes).
11. **Verify** — `https://hams.hawanaairways.com` and `/login` in a private window.

If logs implicate **sharp**, **image optimization**, or **middleware**, redeploy with the commit that includes the table above.

---

## Production looks unstyled (Tailwind / layout “broken” but HTML loads)

**Symptom:** `https://hams.hawanaairways.com` returns HTML, but **no Tailwind**, sidebar looks raw, spacing wrong — often **CSS/JS requests return 302 to `/login`** instead of the static file (browser then skips the stylesheet).

**Cause:** Auth **middleware** must **never** redirect `/_next/static/*`, `/_next/image`, `/brand/*`, or other static paths. This repo enforces that with:

1. A **matcher** that skips `/_next/` and common static extensions.  
2. An **`isStaticAssetPath()`** guard at the top of `middleware.ts` so Vercel/path edge cases still bypass session logic.

**Also check in the browser (Network tab):**

- `/_next/static/css/*.css` → status **200**, `Content-Type: text/css`  
- `/_next/static/chunks/*.js` → **200**  
- If you see **302** → `/login` on those URLs, redeploy the commit with the middleware guard.

**Other checks:** `tailwind.config.js` **content** globs include `./app/**`, `./components/**`, `./lib/**`; `postcss.config.js` includes `tailwindcss` + `autoprefixer`; **no** `basePath` / `assetPrefix` in `next.config.mjs`. Root **`metadataBase`** is set from `NEXT_PUBLIC_SITE_URL` (or `VERCEL_URL` fallback) in `app/layout.tsx` for correct absolute metadata on Vercel.

**CSP:** Production **does not** set a blanket `Content-Security-Policy` on all responses (that pattern can break stylesheet/script application for `/_next/static/*` on some hosts). Other security headers (HSTS, `X-Frame-Options`, etc.) remain. Re-add CSP only with a Next‑aware, route-scoped or nonce-based policy if required by policy.

**Tailwind “almost no utilities” (unstyled UI) when Vercel Root Directory is wrong:** If `next build` runs with **cwd = monorepo root** instead of **`frontend/`**, Tailwind’s default `content` globs (`./app/**`) scan the **wrong tree** and purge almost all classes — the CSS file is much smaller than a healthy build. This repo’s **`tailwind.config.js`** also lists **`./frontend/app/**`**, etc., so the stylesheet stays complete even if the Vercel project root is mis-set once. **Correct setting remains `frontend`.**
