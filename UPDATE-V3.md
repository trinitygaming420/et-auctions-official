# E&T Live v1.1 marketplace update

## Required Supabase update

Open the Supabase SQL Editor and run the complete contents of:

`supabase/migrations/002_live_marketplace.sql`

This adds seller applications, live-show products, payout control, ratings,
admin-only functions, realtime orders, and assigns the existing account
`xxtgxxgangxx@gmail.com` as owner/admin.

If that email has not registered in the app yet, create the account first and
run the final `update public.profiles ...` statement again afterward.

## App behavior

- Home searches and displays all Supabase shows whose status is `live`.
- Live is no longer a bottom tab.
- Sell is live-auction only and requires seller approval.
- Starting a show creates the product and live show in Supabase, then opens the
  LiveKit camera and microphone broadcaster.
- Bids and chat update through Supabase Realtime.
- Ending an auction creates an order for the highest bidder and removes the
  show from Home.
- Account includes editable display name, verified seller badge, My Orders,
  Following, Ratings, seller approvals, and owner-controlled payouts.
- Payments remain test/demo status. No real card is charged.

## Build

Use `.github/workflows/build-standalone-apk.yml` to build an APK that includes
the JavaScript bundle and does not require Metro.
