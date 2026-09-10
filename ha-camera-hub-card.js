const VERSION = "0.2.1";

const EVENTS_REFRESH_MS = 2 * 60 * 1000;
const SYSTEM_TICK_MS = 30 * 1000;
const EVENTS_WINDOW_HOURS = 36;

const TYPE_INFO = {
  person: { label: "Person", icon: "mdi:account", cls: "person" },
  animal: { label: "Dyr", icon: "mdi:paw", cls: "animal" },
  pet: { label: "Kæledyr", icon: "mdi:paw", cls: "animal" },
  vehicle: { label: "Køretøj", icon: "mdi:car", cls: "vehicle" },
  car: { label: "Bil", icon: "mdi:car", cls: "vehicle" },
  package: { label: "Pakke", icon: "mdi:package-variant", cls: "object" },
  license_plate: { label: "Nummerplade", icon: "mdi:card-text-outline", cls: "object" },
  face: { label: "Ansigt", icon: "mdi:face-recognition", cls: "object" },
  motion: { label: "Bevægelse", icon: "mdi:motion-sensor", cls: "motion" },
};
const FILTERS = [
  ["all", "Alle", "mdi:view-list"],
  ["person", "Person", "mdi:account"],
  ["vehicle", "Køretøj", "mdi:car"],
  ["animal", "Dyr", "mdi:paw"],
  ["motion", "Bevægelse", "mdi:motion-sensor"],
  ["object", "Andet", "mdi:bell-ring"],
];

class HACameraHubCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = undefined;
    this._sig = "";
    this._tab = "live";
    this._filter = "all";
    this._liveFeeds = {};
    this._liveGeneration = 0;
    this._events = [];
    this._eventsFetchedAt = 0;
    this._eventsFetching = false;
  }

  static getStubConfig() {
    return {
      title: "Overvågning",
      subtitle: "Live, hændelser og systemstatus",
      protect_ingress_path: "/hassio/ingress/local_unifi-protect-ingress",
      cameras: [
        { key: "fordor", name: "Fordør", icon: "mdi:doorbell-video", area: "udenfor", ai: true, res: "medium", doorbell: true },
      ],
      nvr: {
        storage_entity: "sensor.jt_net_protect_storage_utilization",
        capacity_entity: "sensor.jt_net_protect_recording_capacity",
        cpu_entity: "sensor.jt_net_protect_cpu_utilization",
        temp_entity: "sensor.jt_net_protect_cpu_temperature",
        memory_entity: "sensor.jt_net_protect_memory_utilization",
        uptime_entity: "sensor.jt_net_protect_uptime",
        hdd_entities: ["binary_sensor.jt_net_protect_hdd_1", "binary_sensor.jt_net_protect_hdd_2"],
      },
    };
  }

  setConfig(config) {
    const stub = HACameraHubCard.getStubConfig();
    this._config = { ...stub, ...config, nvr: { ...stub.nvr, ...(config?.nvr || {}) } };
    this._cameras = (this._config.cameras || []).map((c) => ({
      ...c,
      camera_entity: `camera.${c.key}_${c.res || "medium"}_resolution_channel`,
      event_entity: `event.${c.area}_${c.key}_${c.ai ? "smart_detection" : "motion_detection"}`,
      motion_entity: `binary_sensor.${c.key}_motion`,
    }));
    this._liveFeeds = {};
    this._liveGeneration += 1;
    this._buildShell();
  }

  connectedCallback() {
    this._fetchEvents();
    if (!this._eventsTimer) this._eventsTimer = setInterval(() => this._fetchEvents(), EVENTS_REFRESH_MS);
    if (!this._systemTimer) this._systemTimer = setInterval(() => this._renderSystem(), SYSTEM_TICK_MS);
  }
  disconnectedCallback() {
    clearInterval(this._eventsTimer);
    clearInterval(this._systemTimer);
    this._eventsTimer = undefined;
    this._systemTimer = undefined;
  }

  _watchedIds() {
    const c = this._config;
    return [
      c.nvr.storage_entity, c.nvr.capacity_entity, c.nvr.cpu_entity, c.nvr.temp_entity, c.nvr.memory_entity, c.nvr.uptime_entity,
      ...(c.nvr.hdd_entities || []),
      ...(this._cameras || []).flatMap((cam) => [cam.camera_entity, cam.event_entity]),
    ].filter(Boolean);
  }

  set hass(hass) {
    this._hass = hass;
    const ids = this._watchedIds();
    const sig = JSON.stringify(ids.map((id) => [id, hass?.states?.[id]?.state]));
    this._updateLiveTiles();
    if (sig !== this._sig) {
      this._sig = sig;
      this._renderSystem();
    }
  }

  _s(id) {
    return id ? this._hass?.states?.[id] : undefined;
  }
  _num(id) {
    const n = Number(this._s(id)?.state);
    return Number.isFinite(n) ? n : undefined;
  }
  _esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  _more(id) {
    if (!id) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: id }, bubbles: true, composed: true }));
  }
  _navigate(path) {
    if (!path) return;
    // Ingress-panelet ("/hassio/ingress/...") er ikke en del af Lovelace-SPA'en,
    // så en almindelig pushState+location-changed bliver ikke genkendt af
    // routeren og ender på forsiden. En rigtig navigation virker altid.
    window.location.assign(path);
  }
  _ago(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.round(ms / 60000);
    if (m < 1) return "lige nu";
    if (m < 60) return `${m} min siden`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} t siden`;
    return `${Math.round(h / 24)} d siden`;
  }
  _time(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "--:--" : d.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
  }

  _liveActivity(cam) {
    const on = (suffix) => this._s(`binary_sensor.${cam.key}_${suffix}`)?.state === "on";
    if (cam.ai) {
      if (on("person_detected")) return { text: "Person", icon: "mdi:account", cls: "person" };
      if (on("animal_detected")) return { text: "Dyr", icon: "mdi:paw", cls: "animal" };
      if (on("vehicle_detected")) return { text: "Køretøj", icon: "mdi:car", cls: "vehicle" };
      if (on("object_detected") || on("audio_object_detected") || on("license_plate_detected") || (cam.doorbell && on("doorbell")))
        return { text: "Hændelse", icon: "mdi:bell-ring", cls: "object" };
    }
    if (this._s(cam.motion_entity)?.state === "on") return { text: "Bevægelse", icon: "mdi:motion-sensor", cls: "motion" };
    return { text: "Roligt", icon: "mdi:shield-check-outline", cls: "quiet" };
  }

  _updateLiveTiles() {
    if (!this._hass) return;
    (this._cameras || []).forEach((cam) => {
      this._setLiveFeed(cam);
      const tile = this.shadowRoot.querySelector(`[data-cam-tile="${cam.key}"]`);
      const badge = this.shadowRoot.querySelector(`[data-cam-badge="${cam.key}"]`);
      if (tile && badge) {
        const activity = this._liveActivity(cam);
        tile.className = `cam-tile ${activity.cls}`;
        badge.innerHTML = `<ha-icon icon="${activity.icon}"></ha-icon><span>${this._esc(activity.text)}</span>`;
      }
    });
  }

  async _setLiveFeed(cam) {
    const key = cam.key;
    if (this._liveFeeds[key] === cam.camera_entity) {
      const card = this.shadowRoot.querySelector(`[data-feed="${key}"] [data-live-card]`);
      if (card) card.hass = this._hass;
      return;
    }
    this._liveFeeds[key] = cam.camera_entity;
    const feed = this.shadowRoot.querySelector(`[data-feed="${key}"]`);
    if (!feed) return;
    const generation = this._liveGeneration;
    const state = this._s(cam.camera_entity);
    if (!state) {
      feed.innerHTML = `<div class="missing"><div><ha-icon icon="mdi:camera-off-outline"></ha-icon><br>Kamera ikke fundet</div></div>`;
      return;
    }
    feed.classList.remove("ready");
    const snapshot = document.createElement("img");
    snapshot.className = "snapshot";
    snapshot.alt = cam.name || key;
    snapshot.decoding = "async";
    const entityPicture = state.attributes?.entity_picture;
    if (entityPicture) snapshot.src = this._hass.hassUrl(entityPicture);
    else if (state.attributes?.access_token) snapshot.src = this._hass.hassUrl(`/api/camera_proxy/${cam.camera_entity}?token=${state.attributes.access_token}`);
    feed.replaceChildren(snapshot);
    try {
      const helpers = await window.loadCardHelpers();
      if (generation !== this._liveGeneration || this._liveFeeds[key] !== cam.camera_entity) return;
      const card = await helpers.createCardElement({
        type: "picture-elements",
        camera_image: cam.camera_entity,
        camera_view: "live",
        elements: [],
        aspect_ratio: "16:9",
        fit_mode: "cover",
        tap_action: { action: "none" },
      });
      card.classList.add("live-card");
      card.dataset.liveCard = "";
      card.hass = this._hass;
      feed.appendChild(card);
      this._revealWhenReady(feed, card, generation, key);
    } catch (error) {
      feed.innerHTML = `<div class="missing"><div><ha-icon icon="mdi:alert-circle-outline"></ha-icon><br>Stream kunne ikke indlæses</div></div>`;
      console.error("HA Camera Hub Card", error);
    }
  }

  _mediaReady(node) {
    if (!node) return false;
    if (node instanceof HTMLVideoElement && node.readyState >= 2) return true;
    if (node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0) return true;
    if (node.shadowRoot && this._mediaReady(node.shadowRoot)) return true;
    return Array.from(node.children || []).some((child) => this._mediaReady(child));
  }

  _revealWhenReady(feed, card, generation, key, attempt = 0) {
    if (generation !== this._liveGeneration || !card.isConnected) return;
    if ((attempt >= 4 && this._mediaReady(card)) || attempt >= 80) {
      feed.classList.add("ready");
      setTimeout(() => feed.querySelector(".snapshot")?.remove(), 320);
      return;
    }
    setTimeout(() => this._revealWhenReady(feed, card, generation, key, attempt + 1), 100);
  }

  async _fetchEvents() {
    if (!this._hass?.callApi || this._eventsFetching) return;
    const ids = (this._cameras || []).map((c) => c.event_entity).filter(Boolean);
    if (!ids.length) return;
    this._eventsFetching = true;
    try {
      const start = new Date(Date.now() - EVENTS_WINDOW_HOURS * 3600000);
      const path = `history/period/${encodeURIComponent(start.toISOString())}?filter_entity_id=${encodeURIComponent(ids.join(","))}`;
      const result = await this._hass.callApi("GET", path);
      const byEntity = new Map();
      for (const series of Array.isArray(result) ? result : []) {
        const id = series.find((row) => row.entity_id)?.entity_id;
        if (id) byEntity.set(id, series);
      }
      const events = [];
      for (const cam of this._cameras) {
        const series = byEntity.get(cam.event_entity) || [];
        for (const row of series) {
          const ts = row.state;
          const d = new Date(ts);
          if (Number.isNaN(d.getTime())) continue;
          const eventType = row.attributes?.event_type || (cam.ai ? undefined : "motion");
          if (!eventType) continue;
          events.push({ ts: d.getTime(), iso: ts, cameraKey: cam.key, cameraName: cam.name, cameraEntity: cam.camera_entity, type: eventType });
        }
      }
      events.sort((a, b) => b.ts - a.ts);
      this._events = events.slice(0, 300);
      this._eventsFetchedAt = Date.now();
      if (this._tab === "events") this._renderEvents();
    } catch (error) {
      console.warn("HA Camera Hub Card: events history could not be loaded", error);
    } finally {
      this._eventsFetching = false;
    }
  }

  _typeInfo(type) {
    return TYPE_INFO[type] || { label: type, icon: "mdi:bell-outline", cls: "object" };
  }

  _eventsHtml() {
    if (!this._events.length) return `<div class="empty">Ingen hændelser fundet de seneste ${EVENTS_WINDOW_HOURS} timer</div>`;
    const filtered = this._filter === "all" ? this._events : this._events.filter((e) => this._typeInfo(e.type).cls === this._filter);
    if (!filtered.length) return `<div class="empty">Ingen hændelser matcher filteret</div>`;
    return `<div class="event-list">${filtered
      .slice(0, 150)
      .map((e) => {
        const info = this._typeInfo(e.type);
        return `<div class="event-row" data-nav="${this._esc(this._config.protect_ingress_path)}" title="Åbn i UniFi Protect">
          <div class="event-icon ${info.cls}"><ha-icon icon="${info.icon}"></ha-icon></div>
          <div class="event-main">
            <b>${this._esc(e.cameraName)}</b>
            <span>${this._esc(info.label)} &middot; ${this._time(e.iso)} &middot; ${this._esc(this._ago(e.iso))}</span>
          </div>
          <button class="event-open" data-more="${this._esc(e.cameraEntity)}" title="Vis kamera nu" onclick="event.stopPropagation()"><ha-icon icon="mdi:cctv"></ha-icon></button>
        </div>`;
      })
      .join("")}</div>`;
  }

  _renderEvents() {
    const mount = this.shadowRoot.querySelector("[data-events-mount]");
    if (!mount) return;
    mount.innerHTML = `<div class="filters">${FILTERS.map(
      ([key, label, icon]) => `<button class="filter-chip ${this._filter === key ? "active" : ""}" data-filter="${key}"><ha-icon icon="${icon}"></ha-icon>${label}</button>`,
    ).join("")}</div>${this._eventsHtml()}`;
    mount.querySelectorAll("[data-filter]").forEach((el) =>
      el.addEventListener("click", () => {
        this._filter = el.dataset.filter;
        this._renderEvents();
      }),
    );
    mount.querySelectorAll("[data-more]").forEach((el) => el.addEventListener("click", () => this._more(el.dataset.more)));
    mount.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", () => this._navigate(el.dataset.nav)));
  }

  _renderSystem() {
    const mount = this.shadowRoot.querySelector("[data-system-mount]");
    if (!mount || !this._hass) return;
    const c = this._config.nvr;
    const storage = this._num(c.storage_entity);
    const capacitySec = this._num(c.capacity_entity);
    const capacityDays = Number.isFinite(capacitySec) ? capacitySec / 86400 : undefined;
    const cpu = this._num(c.cpu_entity);
    const temp = this._num(c.temp_entity);
    const memory = this._num(c.memory_entity);
    const uptime = this._s(c.uptime_entity)?.state;
    const hddIssues = (c.hdd_entities || []).filter((id) => this._s(id)?.state === "on").length;
    const online = (this._cameras || []).filter((cam) => this._s(cam.camera_entity) && this._s(cam.camera_entity)?.state !== "unavailable").length;
    const total = (this._cameras || []).length;

    const row = (icon, label, value, warn) => `<div class="row ${warn ? "warn" : ""}"><ha-icon icon="${icon}"></ha-icon><span class="row-label">${label}</span><span class="row-value">${value}</span></div>`;

    mount.innerHTML = `
      <div class="row-list">
        ${row("mdi:cctv", "Kameraer online", `${online} / ${total}`, online < total)}
        ${row("mdi:harddisk", "Lagerplads brugt", Number.isFinite(storage) ? `${storage.toFixed(1)} %` : "—", storage >= 90)}
        ${row("mdi:calendar-clock", "Optagekapacitet tilbage", Number.isFinite(capacityDays) ? `${capacityDays.toFixed(1)} dage` : "—", capacityDays < 3)}
        ${row("mdi:chip", "CPU", Number.isFinite(cpu) ? `${cpu.toFixed(0)} %` : "—", cpu >= 90)}
        ${row("mdi:thermometer", "CPU-temperatur", Number.isFinite(temp) ? `${temp.toFixed(0)}°` : "—", temp >= 75)}
        ${row("mdi:memory", "Hukommelse", Number.isFinite(memory) ? `${memory.toFixed(0)} %` : "—", memory >= 90)}
        ${row("mdi:timer-outline", "NVR oppetid", uptime || "—", false)}
        ${row("mdi:harddisk-plus", "Disk-fejl", hddIssues > 0 ? `${hddIssues} disk(e)` : "Ingen", hddIssues > 0)}
      </div>
      <button class="protect-btn" data-nav="${this._esc(this._config.protect_ingress_path)}">
        <ha-icon icon="mdi:open-in-new"></ha-icon>
        <div><b>Åbn UniFi Protect</b><small>Det native UniFi-interface, med fuld klip-historik og afspilning</small></div>
      </button>
    `;
    mount.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", () => this._navigate(el.dataset.nav)));
  }

  _buildShell() {
    if (!this.shadowRoot) return;
    const c = this._config;
    const tabs = [
      ["live", "Live", "mdi:cctv"],
      ["events", "Hændelser", "mdi:bell-ring-outline"],
      ["system", "System", "mdi:server-network"],
    ];
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;--good:var(--dashboard-success, var(--success-color, #20e3a2));--warn:var(--dashboard-warning, var(--warning-color, #f59e0b));--danger:var(--dashboard-danger, var(--error-color, #ef4444));--accent:var(--dashboard-accent, var(--info-color, #38bdf8));--edge:var(--dashboard-border-neutral, var(--divider-color, rgba(127,145,165,.2)));--muted:var(--dashboard-icon-muted, var(--disabled-text-color, #64748b));--animal:#f97316;--object:#a855f7;--motion:#06b6d4}
      *{box-sizing:border-box}
      ha-card{padding:16px;border-radius:22px;background:var(--card-background-color);border:1px solid var(--edge);color:var(--primary-text-color);box-shadow:var(--ha-card-box-shadow)}
      .head{display:flex;align-items:center;gap:12px;margin-bottom:14px;padding:0 4px}
      .head ha-icon{--mdc-icon-size:24px;color:var(--accent)}
      .head strong{display:block;font-size:16px}
      .head span{display:block;color:var(--secondary-text-color);font-size:12px;margin-top:2px}
      .tabs{display:flex;gap:6px;margin-bottom:14px;padding:0 4px}
      .tab{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 8px;border-radius:12px;border:1px solid var(--edge);background:transparent;color:var(--secondary-text-color);font-size:12.5px;font-weight:800;cursor:pointer}
      .tab ha-icon{--mdc-icon-size:16px}
      .tab.active{color:#fff;background:var(--accent);border-color:var(--accent)}
      .panel[hidden]{display:none}
      .empty{padding:34px 16px;text-align:center;color:var(--secondary-text-color);font-size:12.5px}
      .live-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
      .cam-tile{border:1px solid var(--edge);border-radius:14px;overflow:hidden;background:var(--card-background-color)}
      .cam-tile.person{border-color:color-mix(in srgb,var(--danger) 55%,var(--edge))}
      .cam-tile.animal{border-color:color-mix(in srgb,var(--animal) 55%,var(--edge))}
      .cam-tile.vehicle{border-color:color-mix(in srgb,var(--accent) 55%,var(--edge))}
      .cam-tile.object{border-color:color-mix(in srgb,var(--object) 55%,var(--edge))}
      .cam-tile.motion{border-color:color-mix(in srgb,var(--motion) 55%,var(--edge))}
      .cam-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px}
      .cam-bar b{font-size:12px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .cam-badge{display:flex;align-items:center;gap:4px;flex:0 0 auto;font-size:10px;font-weight:800;color:var(--good)}
      .cam-badge ha-icon{--mdc-icon-size:14px}
      .cam-tile.person .cam-badge{color:var(--danger)}
      .cam-tile.animal .cam-badge{color:var(--animal)}
      .cam-tile.vehicle .cam-badge{color:var(--accent)}
      .cam-tile.object .cam-badge{color:var(--object)}
      .cam-tile.motion .cam-badge{color:var(--motion)}
      .feed{position:relative;aspect-ratio:16/9;overflow:hidden;cursor:pointer;background:#05080d}
      .feed>*{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;display:block;overflow:hidden}
      .snapshot{z-index:2;object-fit:cover;opacity:1;transition:opacity .28s ease}
      .live-card{z-index:1;opacity:0;transition:opacity .28s ease}
      .feed.ready .snapshot{opacity:0;pointer-events:none}
      .feed.ready .live-card{opacity:1}
      .missing{display:grid!important;place-items:center;color:var(--muted);font-size:11px;text-align:center}
      .missing ha-icon{--mdc-icon-size:24px;margin-bottom:4px}
      .filters{display:flex;gap:6px;overflow-x:auto;padding:0 4px 12px}
      .filter-chip{flex:0 0 auto;display:flex;align-items:center;gap:5px;padding:7px 12px;border-radius:999px;border:1px solid var(--edge);background:transparent;color:var(--secondary-text-color);font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap}
      .filter-chip ha-icon{--mdc-icon-size:14px}
      .filter-chip.active{color:#fff;background:var(--accent);border-color:var(--accent)}
      .event-list{display:flex;flex-direction:column;gap:1px;border:1px solid var(--edge);border-radius:14px;overflow:hidden;max-height:520px;overflow-y:auto}
      .event-row{display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--card-background-color);cursor:pointer}
      .event-row+.event-row{border-top:1px solid var(--edge)}
      .event-icon{width:34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:color-mix(in srgb,var(--muted) 16%,transparent);color:var(--muted)}
      .event-icon.person{background:color-mix(in srgb,var(--danger) 16%,transparent);color:var(--danger)}
      .event-icon.animal{background:color-mix(in srgb,var(--animal) 16%,transparent);color:var(--animal)}
      .event-icon.vehicle{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
      .event-icon.object{background:color-mix(in srgb,var(--object) 16%,transparent);color:var(--object)}
      .event-icon.motion{background:color-mix(in srgb,var(--motion) 16%,transparent);color:var(--motion)}
      .event-main{flex:1;min-width:0}
      .event-main b{display:block;font-size:12.5px}
      .event-main span{display:block;margin-top:2px;font-size:11px;color:var(--secondary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .event-open{flex:0 0 auto;width:32px;height:32px;border-radius:10px;border:1px solid var(--edge);background:transparent;color:var(--accent);cursor:pointer;display:flex;align-items:center;justify-content:center}
      .event-open ha-icon{--mdc-icon-size:16px}
      .row-list{display:flex;flex-direction:column;gap:1px;border:1px solid var(--edge);border-radius:14px;overflow:hidden}
      .row{display:flex;align-items:center;gap:10px;padding:11px 13px;background:var(--card-background-color)}
      .row+.row{border-top:1px solid var(--edge)}
      .row ha-icon{--mdc-icon-size:17px;color:var(--accent);flex:0 0 auto}
      .row.warn ha-icon{color:var(--danger)}
      .row-label{flex:1;font-size:12.5px;color:var(--secondary-text-color)}
      .row-value{font-size:12.5px;font-weight:800}
      .row.warn .row-value{color:var(--danger)}
      .protect-btn{display:flex;align-items:center;gap:10px;width:100%;margin-top:14px;padding:13px 14px;border-radius:15px;border:1px solid var(--edge);background:transparent;color:var(--primary-text-color);cursor:pointer;text-align:left}
      .protect-btn ha-icon{--mdc-icon-size:20px;color:var(--accent)}
      .protect-btn small{display:block;color:var(--secondary-text-color);font-size:11px;margin-top:2px}
      @media(max-width:600px){.tab span{display:none}.tab{padding:10px 4px}}
    </style>
    <ha-card>
      <div class="head">
        <ha-icon icon="mdi:cctv"></ha-icon>
        <div><strong>${this._esc(c.title)}</strong><span>${this._esc(c.subtitle)}</span></div>
      </div>
      <div class="tabs">${tabs.map(([key, label, icon]) => `<button class="tab ${this._tab === key ? "active" : ""}" data-tab="${key}"><ha-icon icon="${icon}"></ha-icon><span>${label}</span></button>`).join("")}</div>
      <div class="panel" data-panel="live" ${this._tab === "live" ? "" : "hidden"}><div class="live-grid">${(this._cameras || [])
        .map(
          (cam) => `<section class="cam-tile" data-cam-tile="${this._esc(cam.key)}">
            <div class="cam-bar">
              <b>${this._esc(cam.name || cam.key)}</b>
              <span class="cam-badge" data-cam-badge="${this._esc(cam.key)}"><ha-icon icon="mdi:shield-check-outline"></ha-icon><span>Roligt</span></span>
            </div>
            <div class="feed" data-feed="${this._esc(cam.key)}"><div class="empty">Indlæser…</div></div>
          </section>`,
        )
        .join("")}</div></div>
      <div class="panel" data-panel="events" ${this._tab === "events" ? "" : "hidden"}><div data-events-mount></div></div>
      <div class="panel" data-panel="system" ${this._tab === "system" ? "" : "hidden"}><div data-system-mount></div></div>
    </ha-card>`;

    this.shadowRoot.querySelectorAll("[data-tab]").forEach((el) =>
      el.addEventListener("click", () => {
        this._tab = el.dataset.tab;
        this.shadowRoot.querySelectorAll("[data-tab]").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === this._tab));
        this.shadowRoot.querySelectorAll("[data-panel]").forEach((panel) => {
          panel.hidden = panel.dataset.panel !== this._tab;
        });
        if (this._tab === "events") this._renderEvents();
        if (this._tab === "system") this._renderSystem();
        if (this._tab === "live") this._updateLiveTiles();
      }),
    );

    this.shadowRoot.querySelectorAll("[data-feed]").forEach((feed) =>
      feed.addEventListener("click", () => {
        const cam = (this._cameras || []).find((c2) => c2.key === feed.dataset.feed);
        if (cam) this._more(cam.camera_entity);
      }),
    );

    if (this._hass) {
      this._updateLiveTiles();
      this._renderSystem();
    }
    if (this._events.length) this._renderEvents();
  }

  getCardSize() {
    return 20;
  }
}

if (!customElements.get("ha-camera-hub-card")) customElements.define("ha-camera-hub-card", HACameraHubCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "ha-camera-hub-card",
  name: "HA Camera Hub Card",
  description: "Samlet kamera-hub: live-grid, hændelseslog og NVR-systemstatus for UniFi Protect",
  preview: true,
});
console.info(
  `%c HA CAMERA HUB CARD %c v${VERSION} `,
  "color:#fff;background:#2563eb;font-weight:700",
  "color:#60a5fa;background:#0f172a",
);
