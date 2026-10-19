# Craiova Parking Watch

Chrome Manifest V3 extension for monitoring Craiova residential parking **auction registrations**, not physical vehicle occupancy.

It uses the existing signed-in portal tab to read `/api/person`, `/api/ticket/{page}/5`, and `/api/immobile/{id}?distance_to_parking_lot=30` with same-origin session credentials. No passwords, tokens, identity documents, names, contact details or vehicle data are persisted.

When one of your open auction applications reaches **2+ registrations**, the popup shows **0-registration alternatives** in active, normal public-auction spaces, preferring the same lot and then nearby lots. Zero registrations do not imply a physical vacancy or eligibility.

## Install

1. Download this repository as ZIP and extract it.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the directory containing `manifest.json`.
3. Sign in at https://parcari-ticketing.primariacraiova.ro/ and **keep the portal tab open**.
4. Open the extension popup and click **Refresh**.

Choose your property, polling interval (1/2/5/10 minutes), and search radius (30/50/100 m) in the popup. Automatic polling works while the signed-in site tab remains open, Chrome is running, and authentication remains valid. The user may need to refresh if the city portal uses an Authorization header rather than first-party session cookies.

No backend or build tool is required. Test the parsing/suggestion logic with `node tests/model.test.js`.

Data is reduced in the website tab before crossing into extension storage. Only property IDs/names, lot IDs/names/distances, parking space IDs/numbers/types, public auction registration counts, and own ticket-to-space references are retained. It has not yet been verified against an authenticated live Chrome session. Avoid high-frequency polling; respect portal usage policies.

## Discovery and monitoring

The dashboard automatically enters **Discovery mode** when a complete ticket listing confirms no open auction applications. It lists zero-registration active normal spaces in public auctions, nearest first. With open auction tickets it enters **Monitoring mode**, tracks the registered space, and offers alternatives when registration count exceeds one. If the ticket API fails or pagination exceeds the safety limit, it displays **Registration status unknown** instead of falsely claiming no registrations. Click a numbered space to toggle a manual watch (starred). Watched spaces are monitored regardless of applications, and show competition when count reaches 2+. Watched identifiers are stored locally. Manual watches do not submit applications, and no eligibility is implied.

## Account isolation

Properties are discovered **only** from active addresses returned by the authenticated `/api/person` response. No property ID is hard-coded or requested when account verification fails. The extension hashes the provider user ID within the site tab (raw identity never persisted), clears stale snapshots upon authentication failure, and resets watched spaces/history/property selection when a different account is detected. Existing installs discard older unscoped cache on their next successful refresh. The extension is intended for one signed-in session per Chrome profile; keep only one portal account logged in at a time.
