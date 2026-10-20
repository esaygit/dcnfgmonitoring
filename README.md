# DCN FG Monitoring

A browser-only IWTS importer. It processes the selected PDF and `.xlsx` workbook locally in the browser, then saves approved changes directly back to that user-selected workbook. It does not use a backend or cloud storage.

Use Microsoft Edge or Google Chrome. Users must click **Open monitoring workbook** and select the local `.xlsx` file; browsers do not permit a website to access a predefined PC path. Close the workbook in Excel before saving changes.

The workbook is updated in place while retaining its existing cell formatting, including header colors, borders, and number formats.

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
