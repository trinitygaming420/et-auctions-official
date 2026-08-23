# E&T Auctions — Play Store Demo

An original live-auction marketplace app inspired by the feature set of major live-commerce platforms. It is not affiliated with Whatnot.

## Included demo flows

- Live auction room with video placeholder, countdown and bidding
- Seller listings and fixed-price checkout
- Test payments, orders and refunds (no real money)
- Shipping/order status demonstration
- Seller approval and suspension controls
- 5% platform-fee payout calculation and payout release
- Chat, follows, notifications and giveaway entry
- Dark E&T Electronics design and Android package configuration

## Run

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Run `npx expo start` and scan the QR code with Expo Go.

## Build an APK

1. Run `npm install`.
2. Run `npx eas-cli login`.
3. Run `npx eas-cli build --platform android --profile preview`.

The resulting file is an installable APK. The `production` profile creates a Play Store AAB.

## Production conversion required

This package intentionally uses in-memory demo data and simulated payments. Before accepting real buyers, connect Supabase (auth/database/realtime/storage), a live-video provider, push notifications, shipping APIs, and Stripe Connect. Refunds and payouts must run from a secure server—not from the phone. Update the privacy policy, terms, prohibited-items policy, seller agreement and Play Console data-safety form before release.
