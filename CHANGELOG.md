# Changelog

## 0.5.4 - 2026-09-10

- Insert a new UniFi Protect event immediately when its Home Assistant
  `event.*` entity changes, then reconcile it with recorder history in the
  background.
- Match thumbnails by UniFi event ID when available and by a Home Assistant
  timezone-normalized timestamp otherwise.
- Fetch protected UniFi thumbnails with Home Assistant authentication and
  expose only short-lived local blob URLs to image elements.
- Include motion events for AI cameras and Fordør doorbell events alongside
  smart detections.
- Normalize camera folder names so spaces, hyphens, case and Danish accents do
  not prevent matches such as `Bagindgang` / `Bag indgang`.
- Share the UniFi media root request, load camera thumbnail indexes in parallel
  and invalidate the affected camera cache for a new event.
- Preserve live feeds and stable event/system nodes during ordinary Home
  Assistant updates; update badges and relative timestamps in place.
- Suspend the 13 live camera streams while the Events or System tab is open,
  preventing hidden video connections from starving authenticated thumbnail
  requests. Streams resume when returning to Live.
- Hydrate each camera's event thumbnails as soon as that camera's media index
  is ready instead of waiting for every configured camera to finish browsing.

## 0.5.0 - 2026-09-10

- Add per-event thumbnails from UniFi Protect's media browser.
- Refresh events when the Events tab opens.
