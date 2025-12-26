# In-process integration tests

This folder contains an in-process test that exercises batch member flows using Supabase REST API directly (no HTTP server required).

How to run locally:

- Ensure `.env.local` contains SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
- Run:

  npm run test:integration

CI:
- A GitHub Actions workflow `.github/workflows/in-process-tests.yml` runs the test on push/pull_request.
- Configure the following repository secrets: `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Notes:
- Tests create test users and a batch; they clean up batch and batch_members but not the created users (to avoid accidental removal of real users). You can re-run safely but consider rotating test accounts occasionally.
