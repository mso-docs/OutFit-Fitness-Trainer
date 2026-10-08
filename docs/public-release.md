# Public repository and GitHub Pages edition

## Release audit

The candidate files, Git blob history and generated shipping assets are checked by `npm run check:public`. The script reports categories/locations rather than secret values. It checks private key/token patterns, personal home paths, private tailnet names, sensitive filenames, SQLite content and exported health-data JSON. If a local `.env` exists, its private inference hostname and sufficiently long token/password/key values are additional fingerprints. It also catches ignored files that were force-staged.

`.env` and copies, database/WAL files, data, exports, backups, credentials, machine/IDE settings, logs, dependencies, browser traces and build outputs are ignored. `.env.example` contains public defaults, not personal configuration. Test screenshots use synthetic profiles. Browser storage and server database contents are never part of the Pages build; the Pages bundle does not read the server `.env`.

**No automated scan proves absence of all PII.** Before the first public push:

1. Run `npm run check:public` and `npm audit --audit-level=moderate`.
2. Inspect `git status --short`, `git diff --cached` and `git ls-files`; verify that no environment copies, exports, databases, credentials or real-user screenshots appear. `.gitignore` does not remove files already committed, and `git add -f` bypasses it.
3. Review prose, images and commit identity manually. The existing commit uses a non-noreply author email; the user explicitly chose to retain that identity. The checker prints a review notice without the address. No history rewrite was performed.
4. Choose a repository license before presenting this as an open-source release. No license was selected automatically.
5. Enable GitHub secret scanning/push protection where available and review alerts. If a real credential ever reached public history, rotate/revoke it; removing the visible file alone is insufficient. Review any history cleanup before rewriting shared commits.

Nothing has been pushed or published by this work. The Pages workflow is manually triggered only.

## Browser edition

```bash
npm ci
npm run build:pages
npm run preview:pages
```

Open `http://127.0.0.1:4173`. For development use `npm run dev:pages`. This mode has no OutFit API server: profile, goal, plans, manual logs, check-ins, imports, export/deletion and AI selection run in the browser. Domain validation and constrained planning use the same catalog/policy as server mode. Mutations use browser Web Locks when available; use one active tab on browsers without that API. An interrupted browser generation is not resumed after closing the page; generate a new draft. Chats remain temporary.

Ollama defaults to **`http://127.0.0.1:11434`**. Settings lets users change that origin and choose an installed model. Only the endpoint the user saves receives AI context. Pages never ships the developer's personal model, endpoint, token or data. Direct AI requests specify loopback address space where supported. Connections can fail because Ollama is stopped, its allowed-origin settings reject the page, or browser permissions/network policy block local access. Fallback generation and saved plans remain usable; there is no silent remote inference service.

### GitHub Pages setup

The site contains two entries: `/OutFit/` opens the app and `/OutFit/help.html` opens documentation. Help topics have shareable query links, such as `help.html?doc=integrations`. The Help page renders selected repository Markdown files during the build and needs no API or Ollama connection.

1. Push reviewed source to the intended GitHub repository.
2. In repository Settings → Pages, choose **GitHub Actions** as the source.
3. Run **Build and deploy browser edition** from Actions. The workflow builds `dist/pages` and uploads only that directory. It does not upload `.env`, SQLite, exports, test artifacts or Node server code. The relative Vite base supports project paths such as `/OutFit/`.
4. Add the exact Pages origin to Ollama and restart it. A project path is not part of the origin. Example shell launch:

   ```bash
   OLLAMA_HOST=127.0.0.1:11434 OLLAMA_ORIGINS=https://YOUR-ACCOUNT.github.io OLLAMA_NO_CLOUD=1 ollama serve
   ```

   For an existing macOS/Windows application or Linux service, configure those environment variables using Ollama's documented service/application method rather than starting a second process on the same port. Do not use `OLLAMA_ORIGINS=*` or expose Ollama publicly to make Pages work.

5. In OutFit Settings, select an installed local model and allow the browser's local-network permission prompt if shown. Different browsers and managed-device policies may behave differently. The Pages origin-to-real-Ollama connection must be checked on the user's browser; local browser tests do not prove every HTTPS Pages/CORS/permission combination works.

A phone's localhost means the phone. The local Ollama experience is intended for a browser on the computer running Ollama. A user can choose another trusted endpoint, but HTTPS/private-network restrictions may require additional setup.

### Browser privacy limits

Local browser storage is not encrypted by OutFit and is readable by scripts sharing the origin. GitHub project sites under one `ACCOUNT.github.io` hostname share an origin despite different paths; namespacing prevents accidental key collisions but does not provide a security boundary. Prefer a dedicated trusted origin/custom domain for real health data. Browser clearing, private mode, storage quotas or changing origins can lose saved data; export backups. No live health-provider OAuth tokens are stored in this edition.

The static build is a local-first prototype, not a clinical/security-certified product. The user's browser can modify its own storage; browser validation is not an authorization boundary. The server mode remains available with `npm run build` / `npm start`, SQLite persistence and server-side validation. Browser data and server data are separate; neither is silently copied to the other.

Official references: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Ollama origins and environment configuration](https://docs.ollama.com/faq), [Chrome local-network access](https://developer.chrome.com/blog/local-network-access).
