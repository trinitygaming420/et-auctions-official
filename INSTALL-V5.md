# E&T Live v1.3 installation

1. In Supabase SQL Editor, run `supabase/migrations/005_stripe_shippo_marketplace.sql` once.
2. In Supabase Edge Functions, deploy `marketplace-api` from `supabase/functions/marketplace-api/index.ts` with JWT verification enabled.
3. Deploy `marketplace-return` from `supabase/functions/marketplace-return/index.ts` with JWT verification disabled.
4. Confirm Edge Function Secrets contain `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, and `SHIPPO_API_TOKEN`.
5. Upload the updated root files and the full `src` folder to GitHub. Keep all earlier SQL migration files.
6. Run the GitHub **Build Standalone APK** workflow and install its APK artifact.

## Test sequence

1. Sign in and save a shipping address under Account.
2. As an approved seller, open Financial setup, complete Stripe's sandbox onboarding, return to the app, and tap Refresh setup status.
3. Start a live auction from Sell and finish it with a bid from a second test user.
4. The buyer opens My orders, calculates shipping, and completes Stripe test checkout.
5. The buyer taps **I paid — check payment**.
6. The seller opens Pack and ship orders, marks it packed, then purchases and opens the Shippo test label.

This build uses Stripe and Shippo sandbox/test credentials. It must not be used for real customer money or real shipments until live-account onboarding, webhooks, refund handling, taxes, and production review are completed.
