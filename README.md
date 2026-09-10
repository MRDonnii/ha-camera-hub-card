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

- **Live** — indlejrer [Advanced Camera Card](https://github.com/dermotduffy/advanced-camera-card)
  som et responsivt live-grid for alle konfigurerede kameraer, med
  bevægelses-/AI-triggere pr. kamera. Kortet bygges kun én gang og
  genskabes ikke ved almindelige HA-state-opdateringer, så live-streams
  ikke genstartes konstant.
- **Hændelser** — en kronologisk log over de seneste 36 timers `event.*`
  UniFi Protect-hændelser (person/dyr/køretøj/bevægelse m.m.), med filtre
  og genvej til mere-info samt "Åbn i UniFi Protect".
- **System** — NVR-status: lagerplads, optagekapacitet, CPU, temperatur,
  hukommelse, oppetid og diskfejl, samt en knap til at åbne den native
  UniFi Protect-app via ingress.

### Vigtig begrænsning

UniFi Protect-kameraer har ingen dedikeret "engine" i Advanced Camera Card
(kun `frigate`/`generic`/`motioneye`/`reolink`/`tplink` findes) — de bruger
derfor den generiske engine, som **kun** understøtter live-visning, ikke
klip, snapshots, optagelser eller tidslinje. Derfor bruger Hændelser-fanen
en selvbygget kronologisk log frem for klip-afspilning i kortet — reelle
videoklip skal stadig ses i den native UniFi Protect-app (linket findes i
både Hændelser- og System-fanen).

## Installation

Kopiér `ha-camera-hub-card.js` til
`/config/www/ha-camera-hub-card/ha-camera-hub-card.js`, registrér den som en
module-resource, og tilføj `custom:ha-camera-hub-card` i dashboardeditoren.

Kræver [Advanced Camera Card](https://github.com/dermotduffy/advanced-camera-card)
installeret via HACS for Live-fanen.

## Licens

MIT.
