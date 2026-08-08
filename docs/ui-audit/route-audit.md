# Capinsta UI Redesign Route Audit

Date: 2026-06-24

## Verification Environment

- App server: `next dev --webpack --hostname 127.0.0.1 --port 3010`
- Build check: `next build --webpack`
- Browser QA: Chrome via Playwright, after the in-app Browser `Page.captureScreenshot` API timed out.
- Screenshot directory: `docs/ui-audit/screenshots/`
- Local limitations: production-like dummy secrets were used for UI rendering. No local Postgres/Supabase session was available, so authenticated data states redirected to sign-in and the dynamic landing policy query could not be fully data-verified.

## Screenshots Captured

- `signin-light-1440.png`, `signin-dark-1440.png`
- `signup-light-1440.png`
- `forgot-mobile-light-390.png`
- `caption-presets-light-1440.png`, `caption-presets-dark-390.png`
- `compare-tablet-light-768.png`
- `not-found-light-1440.png`
- `projects-light-1440.png`, `projects-dark-1024.png` (auth-gated sign-in state)
- `admin-login-light-1440.png`, `admin-login-dark-390.png`
- `admin-overview-light-1440.png` (auth-gated/empty because no admin session)
- `editor-light-1366.png`, `editor-dark-1366.png` (auth-gated sign-in state)
- `render-route-1440.png`

## Route Checklist

| Route family | Routes discovered | Redesign coverage | Light checked | Dark checked | Responsive checked | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Root shell | `/`, root layout, error, 404 | Shared tokens/shell/errors updated | Partial | Partial | 1440 | `/` is dynamic and depends on DB site policy; local dummy DB blocked full landing render. |
| Marketing/static | `/about`, `/acceptable-use`, `/accessibility`, `/advertising`, `/animated-caption-generator`, `/auto-subtitle-generator`, `/brand`, `/caption-generator`, `/caption-presets`, `/compare`, `/contact`, `/cookies`, `/copyright`, `/data-retention`, `/disclaimer`, `/faq`, `/features`, `/guides/*`, `/how-it-works`, `/privacy`, `/terms` | Shared marketing shell/components updated; caption presets/compare directly inspected | Yes | Representative | 390, 768, 1440 | Build generated all static pages successfully. |
| Blog/changelog/comparison detail | `/blog`, `/blog/[slug]`, `/changelog`, `/changelog/[version]`, `/compare/[slug]` | Inherits marketing shell/tokens/cards | Build checked | Build checked | Build checked | Dynamic static params generated in production build. |
| Auth | `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, auth layouts | Auth shell/forms redesigned | Yes | Yes | 390, 1440 | Sign-up route rendered blank locally because access policy/session services were unavailable; sign-in/forgot verified visually. |
| Projects | `/projects`, projects layout | Projects page redesigned, cards/empty/loading/filter/button styling updated | Auth-gated state checked | Auth-gated state checked | 1024, 1440 | Full project data state requires authenticated Supabase session. |
| Editor | `/editor/[project_id]`, editor layout | Editor shell/header/export/properties/assets/preview/timeline styling updated | Auth-gated state checked | Auth-gated state checked | 1366x768 | Full editor media/caption state requires authenticated project access. |
| Render/export internal | `/render` | Render route left isolated; no normal shell added | Unauthorized state checked | N/A | 1440 | Render tests passed; `/render` stays outside normal app shell. |
| Admin public | `/admincapinsta11`, `/admincapinsta11/login`, `/admincapinsta11/mfa` | Admin login/MFA shell redesigned | Yes | Yes | 390, 1440 | Login inspected directly. |
| Admin protected | `/admincapinsta11/overview`, `access-control`, `audit-log`, `caption-jobs`, `caption-jobs/[jobId]`, `exports`, `exports/[exportId]`, `feature-flags`, `feedback`, `feedback/[caseId]`, `projects`, `projects/[projectId]`, `security`, `security/[eventId]`, `system`, `transcription`, `transcriptions`, `users`, `users/[userId]` | Shared admin shell/page header/table/button primitives updated | Auth-gated | Auth-gated | Build checked | Protected content requires admin auth/session and DB. |
| Operational states | `/access-revoked`, `/account-unavailable`, `/early-access`, `/maintenance`, `/internal/ui-verification` | Inherits shared shell/tokens | Build checked | Build checked | Build checked | Some are dynamic or internal verification routes. |

## Validation Notes

- Primary action color computed as `rgb(183, 255, 34)` on inspected auth/admin actions.
- Light theme computed body background as `rgb(238, 236, 229)` on normal inspected pages.
- Dark theme computed body background as `rgb(36, 36, 35)` on inspected auth/admin pages.
- Large black blocks were not found on inspected light-mode auth/projects/editor-gated/admin-gated pages. A black feature band remains on caption presets by design.
- Render/export tests passed and confirm render route exclusion plus render color behavior.
