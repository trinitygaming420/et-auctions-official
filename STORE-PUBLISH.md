# E&T Live store release

This package builds Android version 2.1.0 (versionCode 2) as a signed Android App Bundle (`.aab`).

## Build the signed AAB

1. Push this package to the root of the GitHub repository.
2. In Expo, create an access token for the account that owns the E&T Live project.
3. In GitHub, open **Settings → Secrets and variables → Actions** and create a repository secret named `EXPO_TOKEN`.
4. Open **Actions → Build Store AAB → Run workflow**.
5. When the workflow succeeds, open the linked EAS build and download the `.aab`.

## Publish

Upload the `.aab` to the store's testing track first. Complete the store listing, privacy policy, data-safety disclosures, content rating, reviewer login, and account-deletion instructions before requesting production review.

## Production checks required

- Use production Stripe/Connect and shipping credentials only in Supabase Edge Function secrets.
- Verify checkout, refunds, seller onboarding, webhooks, labels, tracking, and payouts with controlled live transactions.
- Test host and viewer flows on separate physical Android devices.
- Confirm ended streams disappear from Home and auctions create exactly one winning order.

Store acceptance and live payment approval are controlled by the store, Stripe, and shipping provider and cannot be guaranteed by an application build.
