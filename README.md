# DCN FG Monitoring

A browser-only IWTS importer. It processes the selected PDF and `.xlsx` workbook locally in the browser, then downloads an updated workbook. It does not use a backend or cloud storage.

## Local development

```powershell
npm install
npm run dev
```

## GitHub Pages

1. Create a GitHub repository named `dcnfgmonitoring` and push this project to its `main` branch.
2. In GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The included workflow deploys the app at `https://<github-user>.github.io/dcnfgmonitoring/` whenever `main` changes.

If the repository has a different name, change `/dcnfgmonitoring/` in `vite.config.ts` to that repository name before pushing.
