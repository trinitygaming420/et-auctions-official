# E&T Live v2 setup

This update keeps Android package `com.etelectronics.etlive`, so its APK updates the installed E&T Live app.

## 1. Database

In Supabase SQL Editor, run `supabase/migrations/001_marketplace.sql` once.

## 2. Secure livestream token function

Deploy `supabase/functions/livekit-token`. In Supabase Edge Function secrets, add:

- `LIVEKIT_URL` = `wss://project-e-t-auctions-v8gsnc5i.livekit.cloud`
- `LIVEKIT_API_KEY` = the LiveKit API key named **E&T Auctions Backend Final**
- `LIVEKIT_API_SECRET` = its secret (enter only in Supabase; never put it in source or the APK)

## 3. Build

Upload the ZIP contents to the existing `et-auctions-new` GitHub repository. Keep `.eas/workflows/create-android-apk.yml`. A push to `main` starts the Expo APK workflow.

## Included

Native LiveKit host/viewer video, camera and microphone permissions, bidding UI, chat UI, products, seller hub, 5% fee order schema, seller approvals, schedules, follows, giveaways, payouts/refunds demo controls, and secure Supabase token generation.

Payment capture and seller payouts remain in test/demo mode until Stripe Connect server credentials and webhooks are configured. Never store Stripe or LiveKit secrets inside `App.js`.
