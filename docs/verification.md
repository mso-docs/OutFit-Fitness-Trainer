# OutFit prototype verification

Date: October 8, 2026. This report describes actual automated checks and separates external/human checks that remain outstanding. OutFit is the project; Touch Grass is the hackathon theme.

## Environment and checks

- Node **24.21.0**, npm **11.19.0**, TypeScript **5.9.3**.
- React/React DOM **19.3.0**, Vite **7.3.7**, Fastify **5.12.5**, Zod **4.6.5**.
- Vitest **3.2.7**, Playwright **1.64.0**, Chromium **156.0.8078.4**, axe-core integration **4.13.0**.
- The exact installed versions are in `package-lock.json`; the runtime download was checksum-verified against Node's published SHA-256 file.
- Typecheck, ESLint, and production build passed.
- **59 automated domain/API/AI/adapter tests passed** in the original prototype run against synthetic data and isolated SQLite databases.
- **8 browser tests passed** across the two viewports. Each viewport uses a separate loopback test server and database; the normal five-generations-per-minute rate limit stays enabled. Desktop uses **1440×1000**; mobile uses **360×800** with touch/mobile emulation.
- Tailnet follow-up: typecheck and ESLint passed; all **22 API tests** passed, including explicit remote-origin opt-in, default rejection, and credential/path/query/fragment/protocol rejection. `.env` now enables `OLLAMA_ALLOW_REMOTE=true` for the user-configured server. `ollama-server.example.ts.net` resolved to `<TAILNET_IP>`, but direct API requests timed out; Tailscale reported that peer offline. Real-model smoke tests via hostname and IP failed availability checks. No inference success is claimed.
- Real Ollama generation **passed** at `2026-10-08T04:57:53.007Z`: Node `v24.21.0`, Ollama `0.32.13`, model `qwen3.8:27b`, digest `22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`, duration **47,255 ms**, source `ollama`, seven validated days, prompt/policy `outfit-1`. Private server identifiers are omitted. Discovery now allows up to ten seconds. Model metadata has a separate 256 KiB bound (generation stays at 64 KiB); supported non-thinking controls avoid exhausting the generation deadline. Typecheck, lint, build and all **63 tests** passed after the integration fixes.

## Acceptance-criterion evidence

| Spec criterion                                                        | Evidence                                                                                                                                                                                           | Result / limit                                                                                                                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Fresh SQLite migration, onboarding, persistence                    | API fresh-file/restart test; ordered migration runner; browser onboarding and refreshable saved profile                                                                                            | Automated pass. Each Continue saves valid profile fields; incomplete onboarding restarts at step 1 with those fields retained.                                        |
| 2. Small beginner foundation, no note override                        | Domain unknown/zero baseline and consecutive-availability cases; AI raw-note exclusion; browser escaped injection-like note                                                                        | Automated pass: only short easy catalog walks, with rest between.                                                                                                     |
| 3. Seven dates, ceilings, catalog, timezone                           | Domain DST/non-US tests, availability/budget/catalog totals and strict plan round-trip; all generated drafts use the same validator                                                                | Automated pass.                                                                                                                                                       |
| 4. One real local model                                               | Loopback connectivity check; executable `scripts/ollama-smoke.ts`                                                                                                                                  | Passed against the configured private server: seven validated days in 47,255 ms.                                                                                      |
| 5. Offline/missing/timeout/malformed/extra/truncated/unsafe proposals | Eleven AI-provider tests; API fallback job; browser fallback source label                                                                                                                          | Automated pass. Bounded repair and deadline; fallback is independently validated.                                                                                     |
| 6. Safety overrides generation/adaptation/acceptance/Today            | API safety-block tests and persistent latch; browser symptom check-in disables exercise generation while keeping logging/export available                                                          | Automated pass. Observation editing/deletion and generic profile edits cannot silently clear the latch. Explicit screening clears eligible historical flags.          |
| 7. Observation statuses, edits, idempotency                           | API create/edit completed→partial→skipped→completed, delete, duplicate keys, duplicate links, invalid future/rest links; browser planned and unplanned forms                                       | Automated pass. Actual volume is not constrained to prescription volume.                                                                                              |
| 8. Recovery and progression restrictions                              | Domain low recovery, missed sessions, immutable history, no midweek increase, favorable rollover cap, missing check-ins and seven-day restart                                                      | Automated pass. Current-week regeneration uses an explicit adaptation guard to prevent bypassing reductions. Catalog steps never round up to force progression.       |
| 9. Immutable sessions, atomic acceptance, discarded drafts            | Domain ID/content preservation; API adaptation/acceptance/discard cases and SQL unique accepted-plan index                                                                                         | Automated pass. Logged/past adaptation content retains exact IDs.                                                                                                     |
| 10. Stale/concurrent jobs, restart, deletion                          | API deferred-provider races; aggregate revision conflict; concurrent accept; recovered `SERVER_RESTARTED`; deletion rejects late persistence                                                       | Automated pass. Real provider additionally receives an abort signal on deletion/shutdown.                                                                             |
| 11. Honest progress / canonical history                               | Domain partial/unplanned/unknown metrics, null denominator, deduplicated retained IDs, superseded-future exclusion; API recomputation                                                              | Automated pass. Supersession local dates are persisted at acceptance and remain fixed through timezone edits; a domain test covers that boundary.                     |
| 12. Desktop/mobile and keyboard accessibility                         | Playwright core loop, document-width checks, keyboard onboarding/acceptance, dialog trap, inline timezone error, Escape; axe WCAG A/AA checks on onboarding, Today, preview, Progress and Settings | All eight desktop/mobile browser tests passed. Focus and live-status hooks are exercised. This is not a complete accessibility certification or screen-reader review. |
| 13. Export/delete and fixture adapter                                 | API versioned export/deletion tests; browser downloaded JSON parse and return to onboarding; fixture dedup/update/tombstone/revoke tests                                                           | Automated pass. No provider credentials or production import endpoint.                                                                                                |
| 14. Origin/access/strictness/rendering/privacy                        | API foreign host/origin, malformed/extra fields, arbitrary inference URL/remote opt-in guard; React note-escaping and provider note-exclusion tests; logger disabled                               | Automated pass for exercised cases; route errors are sanitized. No raw health text or model/prompt text is sent to ordinary diagnostics.                              |

## Browser coverage

The four flows run on both desktop and mobile:

1. Onboarding → labelled fallback preview → acceptance → planned workout → recovery check-in → adaptation preview/acceptance → progress → JSON download → confirmed deletion.
2. Safety check-in → immediate recommendation pause → disabled generation → logging and export still available.
3. Keyboard-opened log dialog → focus cycles inside → plain-text injection-like note → progress rendering without injected HTML.
4. Keyboard onboarding with an invalid timezone, inline error/`aria-invalid`, corrected inputs, and keyboard plan acceptance.

The suite checks browser console errors in the core loop and horizontal overflow at relevant screens. Axe scans check contrast, labeling, semantics and landmarks for rendered states. Text contrast and mobile dialog scrolling/positioning issues found during the initial runs were fixed before the final run.

Screenshots: [desktop Today](screenshots/today-desktop.png), [360px Today](screenshots/today-mobile.png). They use synthetic profile data and genuine generated/accepted fallback plans, not hard-coded success displays.

## Remaining checks and prototype choices

- Real generation evidence above uses synthetic fixtures. Actual user profiles still pass the same independent validators; unavailable or invalid responses continue to fall back.
- Conduct a human onboarding/logging walkthrough to assess the three-minute/one-minute usability targets. Automated flow duration is not evidence for human completion time.
- Manually review with a screen reader, and try a real phone if planning a network demo. Emulated 360px testing is not a claim of native phone inference or independent offline use.
- Have a qualified professional review the catalog and thresholds before broader use; they remain product defaults from the supplied specification.
- Node SQLite + ordered SQL migrations substitutes for Drizzle. A missing startup model is allowed for immediate fallback use; installed-model selection remains validated. Model prose is replaced by fixed explanations.
- A new full week cannot overlap the current accepted week. Use adaptation to change that week. This conservative prototype guard prevents regenerating around midweek restrictions.
- The latest seven days are the UI progress-summary range. The API also accepts explicit ranges. There are no live health integrations, cloud hosting, accounts, notifications, routes, weather, or PWA caching.
- No entry or DEV post was published or submitted. Hackathon writing and outdoor-use evidence are separate tasks.

## Trainer, measurement and health-data extension

- Typecheck, lint and production build passed; **69 automated tests passed** across domain, API, AI, trainer and adapter suites.
- **10 desktop/mobile browser tests passed**, including optional measurement persistence after reload, trainer offline labeling, source-labelled health import display, no horizontal overflow, and axe accessibility checks on the new screens.
- Real trainer generation with a synthetic walking-habit question passed against the configured model: source `ollama`, 352 answer characters, **30,493 ms**. Conversation and private server identifiers are omitted from diagnostics.
- Measurement edits use profile revision checks; imports validate chronology/timezones and reconcile updates/deletions. Tests verify duplicate import handling, export inclusion, removal, and separation from manual progress.
- Chat tests cover policy/context construction, supported thinking controls, unusable/truncated responses, safety gating, context minimization and unchanged plan/input revisions. This is prototype evidence, not certification that unrestricted model conversations cannot produce unsafe advice.
- Live OAuth/native health-store sync remains unimplemented. See [health integration design](health-integrations.md).

Trainer Markdown fix: typecheck/build and lint passed; two targeted desktop/mobile browser tests passed. Verified semantic bold/italic/list rendering, disabled raw HTML/images, safe link transformation, accessibility and no horizontal overflow. User-authored messages remain plain text; trainer replies use react-markdown and remark-gfm.

## Public-release preparation and static browser edition

- The public-candidate/source-history/shipping-asset check passed with **zero pattern/file findings** across **57 candidate files**. This is bounded automated evidence, not proof that no PII exists. The existing commit identity remains at the user's explicit request; its non-noreply author-email review notice is expected. No history rewrite occurred.
- Private environment copies, databases, exports, credentials, IDE/machine settings, logs and browser traces are ignored. No public push or Pages deployment was made. A license was not selected automatically.
- Dependency advisories were addressed with `@fastify/static` **10.1.5**, Vitest **5.0.3**, updated concurrently, and a patched shell-quote override. **npm audit reported zero vulnerabilities** after installation. This is registry evidence at the time of the check, not a promise about future advisories.
- Typecheck, lint, all **69 automated tests**, and both production/static builds passed.
- **12 server-mode desktop/mobile browser tests passed** after the dependency updates.
- **14 Pages-mode desktop/mobile browser tests passed** under `/OutFit/`, including shared onboarding, safety gating, logging, adaptation, accessibility, measurement persistence, file-import display, export and deletion. Direct Ollama planning/chat was exercised with a synthetic browser-intercepted provider; a test verifies that the browser edition makes no OutFit `/api/v1` network requests.
- Actual HTTPS GitHub Pages → real local Ollama inference and browser-specific CORS/local-network permission behavior remain external deployment checks. The earlier real-server inference/chat evidence does not establish this combination. No real user data was copied into browser test storage or shipping assets.
- Browser edition default inference origin is `http://127.0.0.1:11434`; settings can select a trusted custom origin. Browser persistence is separate from server SQLite, is not encrypted, and shares the site's origin trust boundary.
