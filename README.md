# DCN FG Monitoring

A shared IWTS monitoring dashboard. The browser extracts data from an uploaded PDF and saves reviewed records to Supabase PostgreSQL. All signed-in users see database changes live.

## Supabase configuration

Create `.env.local` using `.env.example`, then add the Supabase **Project URL** and **Publishable key**. Never use a `service_role` key in this frontend.

For GitHub Pages, add repository Actions secrets named `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The deployment workflow uses them only while building the static site.

## Local development

```powershell
npm install
npm run dev
```

## Deployment

1. Create a GitHub repository named `dcnfgmonitoring` and push this project to its `main` branch.
2. In GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The included workflow deploys the app at `https://<github-user>.github.io/dcnfgmonitoring/` whenever `main` changes.

If the repository has a different name, change `/dcnfgmonitoring/` in `vite.config.ts` to that repository name before pushing.
