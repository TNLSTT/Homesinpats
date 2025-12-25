# Homes in Pats

A lightweight Node.js site for collecting home notifications and managing listings without external dependencies.

## Features
- Home page prompts visitors to subscribe for alerts or create listings.
- Listings require admin approval before appearing and notifying subscribers.
- Listings automatically disappear after 5 days.
- Admin dashboard (protected by an admin key) for approvals.

## Running locally
1. Ensure you have Node.js 18+ installed.
2. Install dependencies (none beyond Node standard library).
3. Start the server:
   ```bash
   npm start
   ```
   The app listens on port `3000` by default; override with `PORT=4000 node server.js`.
4. Visit `http://localhost:3000` in your browser.

### Admin access
Set an admin key via environment variable or use the default:
```bash
ADMIN_KEY=approve-it npm start
```
Then open `http://localhost:3000/admin?key=approve-it` to approve listings.

## Data storage
Data is stored as JSON files under `data/`:
- `listings.json` – submitted listings (pending/approved). Entries older than 5 days are removed automatically.
- `subscribers.json` – emails to notify on approval.
- `notifications.log` – log of notifications when a listing is approved.
