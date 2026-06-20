# Deploying the ConjureDB site

The site is a static Docusaurus build in `website/`. It deploys to **GitHub Pages** from a
**dedicated repository**, served on the apex domain **`conjuredb.com`** (already wired up in
`docusaurus.config.ts` and `website/static/CNAME`).

> **Codename note:** keep the new repository name clean (e.g. `conjuredb-site`) — not the
> internal codename. Combined with the `conjuredb.com` custom domain, nothing public ever
> exposes the codename.

## 1. Local development

```bash
cd website
npm install        # first time only
npm start          # dev server at http://localhost:3000
npm run build      # production build into website/build
npm run serve      # preview the production build locally
```

The production build is strict about route links; keep it green.

## 2. Put the site in its own repository

The `website/` folder can live in a dedicated repo. Two simple options:

- **Move `website/` to the new repo root** (recommended for a standalone site repo), then
  the deploy workflow's `working-directory: website` and `path: website/build` should be
  changed to the repo root (`.` and `build`).
- **Keep `website/` as a subfolder** in the new repo and reuse `.github/workflows/deploy-site.yml`
  unchanged.

Either way: also set `organizationName` (the GitHub account) and `projectName` (the new repo
name) in `docusaurus.config.ts`. With a custom domain these only affect the manual deploy
command, not the published output — but keep them accurate.

## 3. Enable GitHub Pages

1. Push the site + `.github/workflows/deploy-site.yml` to the new repo's default branch
   (`master`/`main` — adjust the `branches:` trigger in the workflow to match).
2. In the repo: **Settings → Pages → Build and deployment → Source = GitHub Actions**.
3. The workflow builds and publishes automatically; watch it under the **Actions** tab.

## 4. Point `conjuredb.com` at GitHub Pages (in GoDaddy)

`website/static/CNAME` already contains `conjuredb.com`, and the GitHub **Settings → Pages →
Custom domain** field should be set to `conjuredb.com` (then tick **Enforce HTTPS** once the
certificate is issued).

In GoDaddy → your domain → **DNS / Manage DNS**, add the apex records:

| Type | Name | Value                 |
|------|------|-----------------------|
| A    | @    | `185.199.108.153`     |
| A    | @    | `185.199.109.153`     |
| A    | @    | `185.199.110.153`     |
| A    | @    | `185.199.111.153`     |
| AAAA | @    | `2606:50c0:8000::153` |
| AAAA | @    | `2606:50c0:8001::153` |
| AAAA | @    | `2606:50c0:8002::153` |
| AAAA | @    | `2606:50c0:8003::153` |

Optional — make `www.conjuredb.com` work too:

| Type  | Name | Value                  |
|-------|------|------------------------|
| CNAME | www  | `<account>.github.io`  |

(Replace `<account>` with the GitHub account that owns the new repo. The value is the
account's `github.io` host — it does **not** include the repo name.)

> The IPs above are GitHub's published Pages addresses — confirm the current values in
> GitHub's "Managing a custom domain for your GitHub Pages site" docs before relying on them
> long-term. GoDaddy may already have a parked `A @` record; delete it first.

DNS can take minutes to a few hours to propagate. When done, the site is live over HTTPS at
`https://conjuredb.com`.

## 5. Pre-publish checklist

- [ ] `npm run build` is green locally.
- [ ] `grep -ril unimemory website/build` returns nothing (codename scrub).
- [ ] New repo name is clean (no codename); workflow branch trigger matches the default branch.
- [ ] GitHub Pages source = **GitHub Actions**; custom domain `conjuredb.com` saved; **Enforce HTTPS** on.
