# Craiova Parking Watch

Chrome Manifest V3 extension showing **authenticated building, lot and numbered-space inventory**, plus auction registration demand when it can be established. Inventory remains visible outside the selection period and does not require open applications or public auctions. This is read-only: no applications, bids, reservations or portal changes.

## Install or reload 1.0.2

1. Download/check out the extension revision and extract it if needed.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the directory containing `manifest.json`. For an existing unpacked installation, update that same directory and click its **Reload** button.
3. Sign in at [the official portal](https://parcari-ticketing.primariacraiova.ro/) and **keep its tab open**.
4. Open Parking Watch and press **Refresh**. Check the building selector, lots and numbered spaces. No server deployment, backend or build tool is required; `djparkingweb` is independent and unchanged.

Choose a building, polling interval (1/2/5/10 minutes), and radius (30/50/100 m). Polling requires Chrome, an open portal tab and a valid first-party session. Cookie-only authentication may fail if the city requires a bearer header; the extension does not copy tokens or intercept credentials. Use one portal account per Chrome profile.

## What the states mean

- **Inventory:** linked buildings and all returned lots/numbered spaces, regardless of auctions or tickets. Empty arrays say “no results returned”; missing/malformed arrays say inventory unavailable, with warnings. Missing auction metadata cannot remove a valid building/lot/space. No stale inventory is substituted when the server stops returning it. If a building request fails or returns a different ID, retain only its account-verified linked ID with inventory unavailable; never attribute the returned wrong payload to it.
- **Registration/selection closed:** a lot reports `can_apply_for_auction: null` together with `can_apply_for_waitlist: true`, the outside-session branch in the official frontend. `false` can mean the account already applied; it does **not** prove closure. Other combinations remain unknown or are labeled account eligibility only.
- **Auction ended:** a valid timezone-qualified `auction_end_date_time` is past. `public` alone does not establish a current auction or an open registration period. Unknown status/date semantics remain unknown.
- **Allocation:** `availability: "free"`, used by the official frontend, is labeled **Unallocated (portal report)**. It does not promise a physical vacancy or eligibility. No other allocation values are mapped without evidence; all others display **Allocation unknown**. Neither `status: "active"` nor 0 registrations proves allocated/unallocated. An allocated label needs a verified API value that is not available in the inspected source.
- **Counts:** only a uniquely identified auction supplies counts. With multiple auctions, choose the unique newest start only if all start timestamps include timezones; otherwise suppress ambiguous counts. Deleted items and duplicate spot entries do not supply counts. Never prioritize an older auction merely because it is public.
- **Current reported demand and 2+ alerts:** require a public auction, identified auction ID, future end, no explicit closed registration state, and a nonnegative integer count. Counts are observations of demand, not proof that registration or bidding is open. `can_apply_for_auction: false` does not suppress monitoring of an existing application. Alternatives additionally require explicit account application eligibility and active normal spaces. These are demand candidates, never verified vacancies. Conservative unknown dates may suppress suggestions. Auction bidding start is used for chronology, not as a registration gate: selection/registration may occur before bidding starts. The extension does not assert that bidding is currently open.
- **Historical counts:** an ended auction's returned count is labeled historical and includes its auction ID. Other uncertain counts are labeled reported/timing unverified. Missing counts stay unknown, never zero. No last-seen count is carried into fresh inventory. Observed history is dated, labeled historical and compares only the same identified auction; pre-1.0.2 history without provenance is discarded. Watches stay account scoped.
- **Applications:** only open `LICITATIE_CRAIOVA` tickets are monitored. No open ticket does not mean no allocation. Incomplete/failed ticket lookup says application status unknown and does not hide inventory.

The popup includes a dated notice for the announced **19 October–8 November 2026** registration campaign. This is separate from live per-lot state and does not assert that every auction ended or that later sessions are closed. The [municipality announcement](https://parcari.primariacraiova.ro/comunicate/) describes verification, direct allocation or auction, payment and authorization as separate later stages.

## Data flow and privacy

The service worker executes a reduced collector in the signed-in portal tab using same-origin session cookies. It verifies `/api/person` first. Linked property IDs come from active `person.address` records, or `/api/immobiles` (`address`/`items`) when the former shape is absent, as used by the current public frontend. Only positive safe-integer property IDs are requested (deduplicated, at most ten). Each `/api/immobile/{id}?distance_to_parking_lot=…` response must match the requested property. Tickets use `/api/ticket/{page}/5` with a ten-page safety limit. All requests are GETs.

Raw person/address records, passwords, cookies, tokens, documents, contact details and vehicles never cross into extension storage. A hash of the account ID scopes reduced snapshots, local watches and history. Storage contains only dashboard property/lot names and identifiers, distance, numbered-space metadata, reduced auction lifecycle/count fields, ticket-to-space references and timestamps. The raw account ID is never persisted. Authentication failure clears the visible snapshot/badge; a different verified account resets watches/history/selection. No public/global inventory endpoint or hard-coded building ID is used.

## Investigation and remaining uncertainty

The previous collector required `person.address` and discarded a whole building when optional auction metadata was malformed. The current public frontend instead loads linked addresses from `/api/immobiles`. The original inventory loop itself did not filter by open tickets/public auctions, but its summaries and suggestions did, and public status was preferred over chronology without checking auction end. The regression tests reproduce these failures with synthetic data. These findings are code evidence, not proof of the precise authenticated response that caused the reported blank popup.

Public frontend inspected on 9 November 2026: [portal](https://parcari-ticketing.primariacraiova.ro/), asset `assets/index-L-05RYNN.js`. It confirms `parking_lots`, `residence_parking_spots`, `can_apply_for_auction`, `can_apply_for_waitlist`, `availability`, auction IDs/start/end fields, and the linked-address endpoint. No authenticated personal API response was fetched or fabricated. Live Chrome authentication and the municipality's actual off-season payload remain unverified.

If inventory is still unavailable, a **sanitized structural sample** can resolve the remaining shape uncertainty: HTTP status and JSON keys/types for `/api/person`, `/api/immobiles` (if requested), and one `/api/immobile/{synthetic-id}` response. Replace every person/building/lot/spot/auction ID consistently with synthetic values, remove names/addresses/geometry/documents/contact/vehicle fields, and keep only relevant booleans, enums, timestamps, array shapes and counts. Never share cookies, authorization headers, tokens, a raw HAR or an unredacted response. No personal response is needed to run the tests.

## Verify

No dependencies required (Node.js 18+):

```sh
node tests/model.test.js
node tests/background.test.js
node tests/popup.test.js
node --check background.js
node --check model.js
node --check popup.js
git diff --check
```

Tests cover off-season/no-auction inventory, malformed optional metadata, linked-address response shapes, ended/overlapping auctions, unknown allocation, missing inventory, ticket failure, wrong-property responses, account switches, authentication failure, count provenance and popup labels/escaping. Synthetic browser rendering checks layout but does not establish authenticated live compatibility.
