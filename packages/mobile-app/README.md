# BongoFleet Rider App (Expo / React Native)

The rider's daily companion: log in, see today's assignment (bike + target),
record payments, and see recent payment history. Payments recorded while
offline are saved on the phone and synced automatically when the connection
returns.

## Running it (development, with Expo Go)

1. Install the **Expo Go** app on your phone (Play Store / App Store).
2. Make sure the backend is running (`docker compose up -d` in the repo root)
   and your phone is on the **same Wi-Fi network** as your computer.
3. Find your computer's LAN IP (Windows: `ipconfig` → IPv4 Address, e.g.
   `192.168.1.50`), then set it in `app.json`:

   ```json
   "extra": { "apiUrl": "http://192.168.1.50:3000" }
   ```

   (`localhost` will NOT work from a phone - that points at the phone itself.)

4. Start the dev server from the repo root:

   ```bash
   pnpm --filter @bongofleet/mobile-app start
   ```

5. Scan the QR code with Expo Go (Android) or the Camera app (iOS).

Log in with a rider account (created by the owner in the dashboard's Riders
page - the owner sets the rider's initial password).

## Offline behaviour

- Recording a payment with no signal saves it to a local queue (AsyncStorage)
  and shows "saved on this phone".
- The queue auto-syncs when connectivity returns (or tap the blue banner).
- If the server rejects a queued payment (e.g. over the daily cap), it is
  dropped from the queue and the rider is told which one and why.
