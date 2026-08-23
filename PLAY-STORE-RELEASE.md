# E&T Live production release

The Android application compiles and the `production` EAS profile creates an
Android App Bundle (`.aab`) for Google Play. Do not publish until every item
below is complete.

## Production services

- Create or select the production Supabase project and run migrations 001–006
  in order.
- Deploy `livekit-token`, `marketplace-api`, and `marketplace-return`.
- Set server-only Supabase secrets: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
  `LIVEKIT_URL`, `STRIPE_SECRET_KEY`, `SHIPPO_API_TOKEN`, and `APP_RETURN_URL`.
- Use Stripe live mode and complete Connect platform verification. Never put a
  Stripe secret key in the mobile app or GitHub.
- Use a Shippo live token and verify the ship-from address and carrier accounts.
- Replace `src/config.js` values if a new production Supabase or LiveKit project
  is used.

## Acceptance test before release

1. Create separate admin, seller, and buyer accounts.
2. Submit and approve a seller application from the admin account.
3. Complete Stripe seller onboarding and save seller/buyer shipping addresses.
4. Start a real two-phone LiveKit auction; verify camera, microphone, chat, bids,
   reconnect behavior, and ending the stream.
5. Win an auction, pay in Stripe test mode, pack it, purchase a Shippo test
   label, and verify buyer tracking.
6. Test cancellation, refund, failed payment, duplicate taps, and app restart.
7. Confirm all Row Level Security rules with buyer/seller/admin accounts.

## Google Play

- Create the Play Console app using package `com.etelectronics.etliveclean`.
  Package names are permanent; confirm this before the first upload.
- Run `npm run build:play` to create the signed AAB. Use Play App Signing.
- Upload first to Internal testing, install from the Play Store, and repeat the
  acceptance test on at least two physical Android devices.
- Add app icon, feature graphic, phone screenshots, descriptions, support email,
  privacy-policy URL, Data safety form, content rating, target countries, and
  account-deletion instructions.
- Increase `android.versionCode` for every later upload.

## Release gate

Production release is blocked until real payments, payouts, labels, refunds,
webhooks, privacy disclosures, and physical-device tests pass. A successful
source bundle or APK build alone does not satisfy this gate.
