# AT&T Fiber and Spectrum availability APIs — capture notes (2026-10-09)

Captured by driving the public web checkers in Chrome and intercepting fetch/XHR.
Both sites sit behind Akamai Bot Manager. Direct server-side calls (curl / Node fetch)
to either endpoint return `403 Access Denied` from `AkamaiGHost`; on Spectrum a primed
session instead returns `428` with a `sec-cp-challenge` proof-of-work payload.
Neither is viable for batch automation from a server without evading bot protection.

## AT&T

Entry page: https://www.att.com/internet/fiber/

1. `GET /address/suggestions?...` — autocomplete (att.com-hosted).
2. `GET /address/format?...` — normalizes the picked suggestion.
3. `POST https://www.att.com/msapi/salesapi/wireless-sales-eapi/v2/service-address-validation`
   - prefetch body: `{"addressLine1":"585 E 222nd St","geographicSubAddress":[],"postcode":"44123","city":"Euclid","state":"OH","customer_type":"Consumer","preFetch":"true"}`
     → `{"content":{"status":"success","message":"PreFetch Completed"}}`
   - real body: same without `preFetch`, plus `"id":""` (and a `geographicSubAddress` entry once a unit is chosen)
   - multi-unit buildings first answer `content.status = "closematch-mdu"` with
     `content.alternateAddress.subAddressTypes[]`; the page re-posts with the chosen unit.
   - success shape (stored by the page in `sessionStorage.qualificationInfo`):
     ```
     content.status = "success"
     content.validAddress { id, streetNr, streetDirection, streetName, streetType, city,
                            stateOrProvince, postcode, postcodeExtension, fullAddress, ... }
     content.serviceQualification[] = [{ category: { name: "INTERNET" | "TV" | "PHONE" | "WLS" | ...,
                                                      services: [ { name, priority, QualificationResult, TransportTypes, MaxDownloadSpeedMbps, MaxUploadSpeedMbps, ... } ] } }]
     ```
   - Fiber signal: INTERNET service `name == "FIBER"` with `QualificationResult == "qualified"`
     and `TransportTypes == "FTTP-GPON"` (test address returned 5000/5000 Mbps).
     Non-fiber fallbacks appear as `WBB` (fixed wireless, transport `AIA`) and `HSIA` (copper).
   - The page also writes `sessionStorage.mktAvailability[0]` with colour flags:
     `mktGiga`, `mktHsia`, `mktIptv`, `mktWireless` = "Green"/"Red", `mktAddressType` = "residential".
4. Page then navigates to `/buy/internet/plans?address_id=...` and renders plans from session state.

Akamai sensor: `POST https://www.att.com/eltgfX/...` (random path, returns 201) fires before
each real call. Server-side POST without it → 403.

## Spectrum (Charter)

Entry page: https://www.spectrum.com/address

1. Autocomplete via SmartyStreets (`us-autocomplete-pro.api.smartystreets.com/lookup`, key embedded in page JS).
2. `POST https://www.spectrum.com/orchestrator/attos/address`
   - body: `{"aptUnit":"","streetAddress":"4717 Main Ave","zipCode":"44004","vParam":"ORG","isMultipleAptUnit":false,"channel":"RESI-COM","retailTransId":null,"fetchOffers":false,"system":"LMP","compressLabels":true,"skipAddOns":true}`
     (`locationKey` is added after a unit is picked)
   - response: `addressResponse.addressCodeMapping { scenario, responseCode, url, tfnMapping, copy, redirectToBuyflow }`
     plus a large `components[]` UI tree.
   - Observed codes: `603` "Location with Active service" (existing account),
     `612` "Commercial match" → /address/commercial. A multi-unit address routes to
     /address/multiple-unit before this call. Serviceable-new-customer and not-serviceable
     codes were not captured because Akamai began returning 403 to in-page fetches after
     ~6 scripted calls.

Akamai sensor: `POST https://www.spectrum.com/xXzoRL/...` (random path, 201). Scripted
in-page bursts get the whole session blocked (403) within minutes.
