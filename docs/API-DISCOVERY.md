# Parking portal API discovery — 9 November 2026

The deployed browser application exposes more lifecycle information than Parking Watch 1.0.2 recognized. In particular, its auction UI supports **preauction**, **ongoing** and **archived**, not just **public**. Version 1.0.3 recognizes these states. Empty/missing auction data is now distinguished from an unrecognized auction status.

This is a map of the **API surface visible in the deployed frontend**, not a claim to have enumerated every server endpoint or verified all response shapes. No backend source, official OpenAPI contract or sanitized authenticated response was available. No endpoint guessing, object-ID enumeration, bids, payments, account updates, document downloads or personal API requests were performed. Browser connection confirmed the existing portal tab; its supported inspection surface did not expose a privacy-filtered network-response API. No personal page records were extracted.

## Evidence

- Base URL: `https://parcari-ticketing.primariacraiova.ro/api/`.
- Public page: https://parcari-ticketing.primariacraiova.ro/.
- Deployed script: https://parcari-ticketing.primariacraiova.ro/assets/index-L-05RYNN.js.
- The public page was checked again during this investigation and still references that asset. Script SHA-256 and source offsets are in [api-call-sites.yaml](api-call-sites.yaml).
- The catalogue records **46 distinct client/method/argument call signatures**, including dynamic expressions. That is not 46 independent REST resources; repeated/variable expressions can resolve to the same endpoint. The external form-schema fetch and WebSocket protocol are documented below separately.
- API clients use `withCredentials: true`. Their response interceptor refreshes once via `GET /person/refresh` on a 401, then retries. No bearer-header construction was found in these client definitions. A separate WebSocket authentication endpoint issues a token; the extension does not request it.
- Frontend evidence establishes what the client expects, not backend authorization guarantees or every enum the backend can return.

## HTTP endpoint map

Paths below are relative to `/api`. Variable placeholders are descriptions, not real identifiers. Methods marked “state change” are documented only and must never be crawled merely because their method is GET.

| Area | Method and path | What the frontend establishes | Extension treatment |
|---|---|---|---|
| Session | `GET /person` | Current signed-in person; addresses and vehicles may be included | Existing identity gate; raw record stays in tab |
| Session | `POST /person/login` | Login, JSON body | Official portal only; no credential storage |
| Session | `GET /person/refresh` | Refresh session after a 401; state change | Not invoked during discovery |
| Session | `GET /person/logout` | Logout; state change | Never crawled |
| Account | `POST /person` | Multipart account registration | Never used by extension |
| Account | `PUT /person` | Multipart person details update | Never used |
| Account | `DELETE /person/soft-delete` | Account deletion | Never used |
| Activation | `GET /person/activate/{code}` | Activates account; state change | Never crawled |
| Activation | `GET /person/activate/resend` | Sends activation email; state change | Never crawled |
| Notifications | `PATCH /person/notify/{id}` | Marks notification read | Never used |
| Vehicles | `POST`, `PATCH`, `DELETE /person/vehicle` | Vehicle management | Never used; no vehicle data retained |
| Addresses | `POST`, `PATCH`, `DELETE /person/address` | Address management | Never used |
| Linked buildings | `GET /immobiles` | `address` or `items` array; filters active records | Supported fallback when person.address is absent |
| Address search | `GET /immobile?search={text}` | Search results in `items` | Not used; no global address enumeration |
| Building inventory | `GET /immobile/{id}` | Building geometry, lots and numbered spaces | Only account-derived IDs |
| Nearby inventory | `GET /immobile/{id}?distance_to_parking_lot=30` | Same building plus nearby lot data; frontend uses radius 30 | Extension supports configured 30/50/100 radius |
| Waitlist | `POST /waitlist` | Body includes parkingLotID, immobileID | Never used |
| Applications | `GET /ticket/{page}/{pageSize}` | Items and total, own applications | Existing bounded pagination |
| Applications | `POST /ticket/LICITATIE` | Multipart parking application | Never used |
| Applications | `POST /ticket/SOLICITARE_LOC_DE_PARCARE_HANDICAP` | Multipart accessible-space request | Never used |
| Applications | `GET /ticket/updatable_ticket_types` | Which ticket types can be edited | Not needed for inventory |
| Applications | `GET /ticket/get_fields_update/{ticketType}` | Editable field schema | Not needed for inventory |
| Applications | `PUT /ticket/update_ticket` | Updates application fields | Never used |
| Applications | `POST /ticket/create_ticket_appendix` | Adds application documents | Never used |
| Applications | `POST /ticket/cancel_ticket` | Cancels application | Never used |
| Applications | `GET /ticket/accept_proposal_for_item_change/{code}` | Accepts a proposed change; state change despite GET | Never crawled |
| Service requests | `POST /ticket/{type}` | Generic multipart request; active contract selection for some types | Never used |
| Support | `POST /ticket/SUPORT_TEHNIC` | Authenticated support request | Never used |
| Support | `POST /ticket/SUPORT_TEHNIC_ANONYM` | Anonymous support request | Never used |
| Own auctions | `GET /auctions` | `auctions_registrations`, `waitlist`; nested auction/items/spot metadata | Potential future account-scoped lifecycle supplement; not yet consumed |
| Auction socket | `GET /auctions/authenticate` | Returns WebSocket token | Not requested or stored |
| Invoices | `GET /auctions/invoice/{page}/{pageSize}` | Invoice list; pending state used in UI | Not needed to enumerate spaces; no payment records fetched |
| Authorizations | `GET /person/get_user_contracts?CNP=…` or `?CUI=…` | Own parking authorization list; frontend passes national/company identifier | Not called; privacy boundary would require a deliberately reduced collector |
| Authorization PDF | `GET /auctions/contract_print/{id}` | Downloads contract PDF | Never fetched |
| Payment | `POST /payment/auction/invoice` | Creates payment flow and returns formUrl | Never used |
| Payment status | `GET /payment/auction/invoice/{id}` | Status/message after payment flow | Not needed for lot allocation |
| Password reset | `POST /mobile/auth/reset-password` | Initiates reset | Never used |
| Password reset | `PUT /mobile/auth/reset-password` | Password/token reset submission | Never used |

An additional schema source appears in the frontend: `GET https://craiova.parko.ai/api/ticketing/ticket/get_fields/{type}`. The application uses it for generic service-request forms. It was not fetched and is outside the extension's host permissions.

## WebSocket protocol

The frontend uses `wss://parcari-ticketing.primariacraiova.ro/auctions/test/{auctionId}/{auctionItemId}`. Despite “test” in the path, the production frontend uses it for bidding; it must not be treated as a harmless test environment.

It obtains a token from `/api/auctions/authenticate`, sends it on connection, and consumes `INIT` and `BROADCAST` messages with `auction`, `auction_item` and `server_time`. Fields include base prices, current_bid, increment, highest_bidder_id and previous_bids. Sending `BID` with auction_id, auction_item_id, amount and increment submits a bid. No connection or message was sent during discovery. This is intentionally outside the extension's read-only design.

## Which unknowns can be resolved safely?

| Field | Evidence and interpretation | Remaining limit |
|---|---|---|
| Auction `preauction` | Scheduled auction; frontend shows countdown to bidding start | Not proof registration is currently open |
| Auction `ongoing` | Bidding in progress according to portal | Counts/bids require separate evidence; no allocation inference |
| Auction `archived` | Archived auction | Archived does not prove who obtained a space or whether authorization exists |
| Auction `public` | Public state used by the original extension | Not synonymous with bidding in progress |
| Past valid auction end | Auction ended | Does not establish allocation/payment/authorization |
| Missing `auctions` | Auction data not returned by portal | Cannot know why it was omitted |
| Empty `auctions: []` | No auction returned for that lot | Not equivalent to registration closed or all spaces allocated |
| Lot can_apply_for_auction true | Portal says this account can apply | Account eligibility, not citywide opening declaration |
| Lot can_apply_for_auction false | Frontend may show already-applied message | Cannot map this to closed |
| Lot can_apply_for_auction null plus waitlist true | Frontend explicitly shows outside-session/waitlist text | Does not establish physical availability |
| Space availability free | Frontend uses it with active status for green rendering | Only a portal availability report; never a guarantee |
| Other space availability enums | No exhaustive enum mapping in public code | Need sanitized enum/shape evidence; do not invent busy/allocated mapping |
| Active/inactive space/item | Operational state | Not proof of allocation |
| Registration count 0 | No registrations reported for that item | Never proof of free, allocated, eligibility or occupancy |
| Ticket open/closed | Application lifecycle | Not a parking authorization |
| Contract ACTIV | Frontend labels active authorization | Only confirms the account's authorization, not all neighboring spaces |
| Other contract statuses | INACTIV, ANULAT, ASTEPTARE_PLATA, REZILIAT, EXPIRAT, SUSPENDAT | Status must be interpreted with validity dates and an exact verified spot link |

The portal's auction “adjudicated/past” category includes **archived auctions OR inactive auction items**. Copying that category as “Allocated” would be wrong. A highest bidder is also not necessarily the holder of an issued authorization.

## Changes in 1.0.3

The extension now labels scheduled, ongoing and archived auction states, distinguishes missing/empty auction data, and treats archived reported counts as historical. It does not relabel other unknowns without evidence. New lifecycle mappings use the existing inventory response and add no new network calls or permissions. Existing conservative candidate/alert rules remain unchanged: recognized bidding states do not automatically become registration candidates.

## What would resolve the remaining data gaps

A sanitized structural response for one account-linked building can establish enum values and whether auction/count metadata is omitted off-season. Only keys/types, booleans, status enums, relevant dates and counts are needed; replace all identifiers consistently and remove addresses/names/geometry/people/vehicles/documents. No raw HAR, credentials or national identifiers are needed.

The separately discovered `/auctions` endpoint could supplement **the signed-in account's** auction lifecycle when inventory omits auctions. That requires tests for exact auction/item/space matching and conflicts before integration. It cannot establish allocation of every numbered space. Authorization integration would additionally need verified non-sensitive spot linkage and a reduced in-tab reader that never persists or exposes CNP/CUI, authorization documents or vehicle details. Those integrations are not implemented speculatively from public code alone.
