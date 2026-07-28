# Media access refresh

`POST /api/v1/capinsta/media/{mediaAssetId}/access` authenticates the user,
loads the owned non-deleted ready asset, and reuses the existing Supabase
preview signer. The client supplies no bucket or path. Backend storage
configuration enforces the maximum TTL.

The browser caches access responses only in memory and refreshes inside a
60-second safety window. Concurrent requests for one asset are deduplicated.
The downloaded `File` and blob URL are also process-local and reused for the
editor session. Cache and blob URLs are cleared when the authenticated storage
scope changes or unmounts.

401 follows the existing authenticated-fetch behavior. Other failures surface
as recoverable media-unavailable errors; ownership failures expose no storage
location. Access refresh never changes project JSON or IndexedDB metadata.

