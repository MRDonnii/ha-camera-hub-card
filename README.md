# HA Camera Hub Card

Et samlet Home Assistant-kort til UniFi Protect: live-grid, hændelseslog og
NVR-systemstatus i ét kort med tre faner (Live / Hændelser / System), bygget
til at være både mobil- og pc-venligt.

```yaml
type: custom:ha-camera-hub-card
title: Overvågning
subtitle: Live, hændelser og systemstatus
protect_ingress_path: /hassio/ingress/local_unifi-protect-ingress
cameras:
  - key: fordor
    name: Fordør
    icon: mdi:doorbell-video
    area: udenfor
    ai: true
    res: medium
    doorbell: true
nvr:
  storage_entity: sensor.jt_net_protect_storage_utilization
  capacity_entity: sensor.jt_net_protect_recording_capacity
  cpu_entity: sensor.jt_net_protect_cpu_utilization
  temp_entity: sensor.jt_net_protect_cpu_temperature
  memory_entity: sensor.jt_net_protect_memory_utilization
  uptime_entity: sensor.jt_net_protect_uptime
  hdd_entities:
    - binary_sensor.jt_net_protect_hdd_1
    - binary_sensor.jt_net_protect_hdd_2
```

## Faner

- **Live** — et responsivt grid med ét live-feed pr. konfigureret kamera,
  bygget udelukkende med Home Assistants indbyggede `picture-elements`
  (`camera_view: "live"`) — ingen eksterne HACS-kortafhængigheder. Hvert
  feed viser kameraets seneste snapshot med det samme og fader over til
  den rigtige live-stream, når den er klar (samme teknik som
  [HA Home Camera Card](https://github.com/MRDonnii/ha-home-camera-card)).
  Hver tile får en farvet kant og et aktivitetsmærke (person/dyr/køretøj/
  bevægelse) ud fra kameraets binary_sensor-detektorer, og tryk åbner
  mere-info for kameraet.
- **Hændelser** — en kronologisk log over de seneste 36 timers `event.*`
  UniFi Protect-hændelser (person/dyr/køretøj/bevægelse m.m.), med filtre
  og et lille thumbnail pr. hændelse (hentet fra UniFi Protects eget
  klip-bibliotek, matchet på event-ID eller et tidszonestabilt tidsstempel og
  cachet pr. kamera i 3 minutter). Beskyttede thumbnail-filer hentes med den
  aktive Home Assistant-session og vises som lokale blob-URL'er; adgangstokenet
  lægges ikke i DOM'en. Smart-detektion, almindelig bevægelse og Fordørens
  dørklokkehændelser indgår. Nye hændelser indsættes straks fra
  Home Assistants live-state og afstemmes efterfølgende med de seneste 36
  timers recorder-historik. Listen kontrolleres desuden hvert 30. sekund i
  baggrunden og altid, når du skifter til fanen. Tryk på en hændelse åbner en indbygget
  medie-browser (Home Assistants `media_source`-API mod UniFi Protects
  egen integration), matcher hændelsens tidsstempel mod klippene i
  kameraets mappe og **starter automatisk afspilning af det nærmeste
  klip** (inden for ±90 sekunder). Kan der ikke findes et sikkert match,
  lander du i stedet i klip-listen, så du kan vælge det rigtige klip
  manuelt — dialogen har også en opdater-knap. Klippet afspilles direkte
  i kortet via et `<video>`-element, uden eksterne afhængigheder. Et
  lille kamera-ikon viser i stedet kameraets nuværende billede (mere-info).

  **Vigtigt om UniFi Protects "Max media"-indstilling:** integrationens
  medie-browser henter events med et loft (`max_media`, standard 1000)
  på tværs af *alle* kameraer i det browsede tidsvindue. Med mange
  aktive AI-kameraer kan loftet nås langt inden døgnet er omme, hvorefter
  hverken denne funktion eller Home Assistants egen medie-browser viser
  nyere hændelser. Sæt `max_media` op (op til 10000) under UniFi Protect
  → Konfigurér i Home Assistant, hvis hændelser ser ud til at mangle.
- **System** — NVR-status: lagerplads, optagekapacitet, CPU, temperatur,
  hukommelse, oppetid og diskfejl, samt en knap til at gennemse alle
  kameraers hændelser i Medier, og en valgfri knap til UniFi Protects
  native web-UI via ingress (kræver at ingress-adgang virker på dit
  setup — visse reverse proxy-opsætninger blokerer `/hassio/ingress/...`).

### Sådan virker klip-afspilningen

Kortet browser `media-source://unifiprotect` via
`hass.callWS({type: "media_source/browse_media", ...})`, finder kameraets
mappe ud fra navnet, og lader dig klikke dig ned til et konkret klip.
Ved afspilning kaldes `media_source/resolve_media` for at hente en
afspilbar URL. Dette kræver at UniFi Protect-integrationen har
hændelser/klip aktiveret (indstillingen "Max media" på integrationens
config-side).

## Opsætning i GUI

Kortet har en fuld visuel editor (åbnes via "Rediger" i dashboardeditoren,
ingen YAML nødvendig): titel/undertitel, ingress-sti, alle NVR-sensorer og
disk-fejlsensorer via entity-pickere, samt tilføj/fjern/rediger for hvert
kamera (nøgle, navn, ikon, område, opløsning, AI-detektion, dørklokke).

## Installation

Kopiér `ha-camera-hub-card.js` til
`/config/www/ha-camera-hub-card/ha-camera-hub-card.js`, registrér den som en
module-resource, og tilføj `custom:ha-camera-hub-card` i dashboardeditoren.
Ingen HACS-afhængigheder kræves.

Kortet bevarer de eksisterende live-feed-elementer ved almindelige state- og
hændelsesopdateringer. Systemværdier og aktivitetsmærker opdateres målrettet,
så streams, hover og fokus ikke nulstilles. De tunge live-streams afbrydes dog
bevidst, mens Hændelser eller System er valgt, og startes igen ved tilbagevenden
til Live; det frigør forbindelser til thumbnails og klip.

## Licens

MIT.
