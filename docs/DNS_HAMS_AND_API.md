# DNS for `hams` and `api` only (Hawana Airways HAMS)

**Goal:** Fix `DNS_PROBE_FINISHED_NXDOMAIN` by defining **`hams.hawanaairways.com`** and **`api.hawanaairways.com`** at the **authoritative DNS** for the domain (cPanel Zone Editor, Cloudflare, etc.—wherever your **NS** point today).

**Safety:** Add **only** two new names. Do **not** edit existing `@`, `www`, **MX**, **TXT** (SPF/DKIM), or other mail-related rows unless you are deliberately migrating the whole zone.

---

## 1. Production URLs (deployment targets)

| Role | Public URL | Build / env block |
|------|------------|-------------------|
| **HAMS frontend** | `https://hams.hawanaairways.com` | `frontend/.env.example` block **(B)** — `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CANONICAL_HOST` |
| **Production API** | `https://api.hawanaairways.com` | `backend/.env.example` — `FRONTEND_URL` includes `https://hams.hawanaairways.com` (and public site origins as needed) |
| **Browser API base** | Same as API | `NEXT_PUBLIC_API_URL=https://api.hawanaairways.com` (no trailing slash) |

Full variable lists: **`docs/PRODUCTION_HAWANA_AIRWAYS.md`** §6.

---

## 2. Where to enter records (Namecheap vs cPanel)

- If Namecheap says **DNS is managed by cPanel/hosting** → open **cPanel → Zone Editor** (or your host’s **DNS** / **Advanced DNS**) for `hawanaairways.com` and add the rows below.  
- If you later move DNS to **Namecheap BasicDNS** or **Cloudflare**, recreate **only** these two hostnames there (again, without deleting mail records).

---

## 3. Exact record types and values (choose your hosting)

CNAME **must** point to a **hostname**, not an IP. If your provider only gives an **IP**, use an **A** record instead of CNAME.

### A) HAMS on **Vercel**, API on **VPS / same machine / other non-Vercel host**

| Host (cPanel “Name”) | Type | Value (target) |
|------------------------|------|----------------|
| `hams` | **CNAME** | `cname.vercel-dns.com` |
| `api` | **A** | **Your API server’s public IPv4** (same as your VPS if Nginx terminates TLS for both vhosts) |

Then in **Vercel** → your HAMS project → **Domains** → add `hams.hawanaairways.com` and follow verification (DNS above satisfies Vercel).

If DNS works but the browser shows **`404: DEPLOYMENT_NOT_FOUND`**, the hostname is not linked to the project that has a production deployment (or the wrong Vercel project). Fix: **`docs/VERCEL_HAMS_DOMAIN.md`**.

**Why not CNAME for `api` on Vercel?** The Express API is usually **not** the same Vercel project as Next; point `api` at the real API origin (A or provider hostname below).

### B) HAMS on **Netlify**

| Host | Type | Value |
|------|------|-------|
| `hams` | **CNAME** | `<your-site>.netlify.app` (Netlify shows the exact target in **Domain settings**) |
| `api` | **A** or **CNAME** | Per your API host (often **A** to VPS IP) |

### C) HAMS on **Cloudflare Pages**

| Host | Type | Value |
|------|------|-------|
| `hams` | **CNAME** | `<project>.pages.dev` (Pages UI shows the target) |
| `api` | **A** or **CNAME** | API origin as above |

### D) **Both** HAMS + API on the **same VPS** (Nginx/Caddy virtual hosts)

You may use **A** for both (simplest, one IP):

| Host | Type | Value |
|------|------|-------|
| `hams` | **A** | **Same public IPv4** as your web server |
| `api` | **A** | **Same public IPv4** |

Optional: **CNAME** `api` → `hams.hawanaairways.com` only if your DNS panel allows CNAME to another name under the same zone and your server answers for both hostnames (less common than dual **A**).

### E) API on **Railway** / **Fly.io** / similar

| Host | Type | Value |
|------|------|-------|
| `hams` | **CNAME** | As in A/B/C for your frontend host |
| `api` | **CNAME** | Hostname shown in the platform (e.g. `*.up.railway.app` / `*.fly.dev`) **or** custom domain target they specify |

---

## 4. Direct answers: “CNAME → hams” and “CNAME → api”

Because the **target** depends on where you deploy, use this rule:

1. **`hams` (CNAME)**  
   - **Vercel:** `cname.vercel-dns.com`  
   - **Netlify / Pages / other:** use the **exact hostname** the dashboard shows for “DNS configuration” / “Check DNS configuration”.

2. **`api` (CNAME)**  
   - Use a CNAME **only** if your API platform gives a **stable hostname** (Railway/Fly/custom load balancer).  
   - If you only have an **IP** for the API, use **A** for `api` — do **not** invent a CNAME.

If you are unsure, **default:** **`hams` = CNAME to your frontend PaaS target**; **`api` = A record to your API server IPv4**.

---

## 5. Automation available in this repo

- **Verify** DNS + HTTPS after you save the zone:  
  `bash scripts/verify-hawana-production-dns.sh`  
  (Uses `dig` and `curl`; safe read-only.)

- **Full automation** of creating records at cPanel/Namecheap/Cloudflare requires **API tokens** and account IDs in CI or a small script **outside** this repo (or add your own workflow with secrets). This repository does not store provider credentials.

### Optional: GitHub Actions (`workflow` scope on the token)

If your Git push credential is allowed to add workflow files, save as `.github/workflows/verify-hawana-dns.yml`:

```yaml
# On-demand DNS + HTTPS verification for Hawana Airways production hosts.
name: Verify Hawana production DNS

on:
  workflow_dispatch:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install dig
        run: sudo apt-get update && sudo apt-get install -y dnsutils

      - name: Run verification script
        run: bash scripts/verify-hawana-production-dns.sh
```

---

## 6. After DNS resolves

1. Issue or proxy **TLS** for `hams` and `api` (Let’s Encrypt on VPS, or SSL on Vercel/Netlify/Cloudflare).  
2. Deploy **API** with `FRONTEND_URL` matching real browser origins.  
3. Build **HAMS** with `NEXT_PUBLIC_API_URL=https://api.hawanaairways.com`.  
4. Re-run **`scripts/verify-hawana-production-dns.sh`** until all checks pass.

---

## 7. Quick propagation check (manual)

```bash
dig +short NS hawanaairways.com
dig +short hams.hawanaairways.com A
dig +short hams.hawanaairways.com CNAME
dig +short api.hawanaairways.com A
dig +short api.hawanaairways.com CNAME
```

When NXDOMAIN stops and you see A/CNAME data, browsers will resolve the hostnames (TTL may be a few minutes to hours).
