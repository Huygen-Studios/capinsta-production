# Supabase authentication setup

## Keys and environment variables

Find the project URL and public anon/publishable key in **Supabase Dashboard → Project Settings → API**. The service-role key is in the same area under secret keys. Keep it server-only.

Frontend / Next.js build and runtime:

```env
NEXT_PUBLIC_SITE_URL=<YOUR_PRODUCTION_DOMAIN>
NEXT_PUBLIC_SUPABASE_URL=<YOUR_SUPABASE_PROJECT_URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<YOUR_SUPABASE_ANON_PUBLIC_KEY>
```

Backend / FastAPI runtime:

```env
SUPABASE_URL=<YOUR_SUPABASE_PROJECT_URL>
SUPABASE_ANON_KEY=<YOUR_SUPABASE_ANON_PUBLIC_KEY>
SUPABASE_SERVICE_ROLE_KEY=<YOUR_SUPABASE_SERVICE_ROLE_KEY>
SUPABASE_JWT_SECRET=<YOUR_SUPABASE_JWT_SECRET_IF_CURRENT_BACKEND_REQUIRES_IT>
```

The current backend verifies asymmetric access tokens with the Supabase JWKS endpoint. `SUPABASE_JWT_SECRET` is needed only if the project still issues legacy HS256 tokens. The service-role key is reserved for future trusted server operations and must never be exposed through `NEXT_PUBLIC_*`, client components, logs, or API responses.

In Coolify, public `NEXT_PUBLIC_*` values must be available as build arguments because Next.js embeds them in the browser bundle. Backend values must be runtime-only environment variables.

## Email authentication

In **Authentication → Providers → Email**, enable Email. Choose whether email confirmation is required. If enabled, Capinsta shows a “Check your email” state until Supabase creates a real session.

Set **Authentication → URL Configuration → Site URL** to:

```text
<YOUR_PRODUCTION_DOMAIN>
```

Add these redirect URLs:

```text
http://localhost:3000/auth/callback
http://127.0.0.1:3000/auth/callback
http://localhost:3000/reset-password
http://127.0.0.1:3000/reset-password
<YOUR_PRODUCTION_DOMAIN>/auth/callback
<YOUR_PRODUCTION_DOMAIN>/reset-password
```

## Google authentication

1. Create a Google OAuth web client in Google Cloud.
2. Use placeholders `<YOUR_GOOGLE_CLIENT_ID>` and `<YOUR_GOOGLE_CLIENT_SECRET>` when documenting or sharing configuration.
3. In Google Cloud, add the Supabase callback shown by the Google provider screen. It has this form:

```text
https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback
```

4. In **Supabase Dashboard → Authentication → Providers → Google**, enable Google and enter the client ID and client secret.
5. Keep the Google client secret in Supabase/Google Cloud only. Do not add it to the frontend or a `NEXT_PUBLIC_*` Coolify variable.

Capinsta sends Google users to `/auth/callback`, exchanges the PKCE code for a cookie-backed session, validates the internal `next` path, and then returns the user to the requested editor/project page.

## Security checks

- Never expose `<YOUR_SUPABASE_SERVICE_ROLE_KEY>`.
- Keep RLS enabled on every user-owned table exposed through the Supabase Data API.
- The current editor project documents are browser-local and isolated by Supabase user ID.
- Caption and export jobs are backend SQLite records with a verified Supabase `user_id`.
- If user-owned tables are later added to Supabase, grant only required privileges to `authenticated` and add `auth.uid() = user_id` select/insert/update/delete policies.
