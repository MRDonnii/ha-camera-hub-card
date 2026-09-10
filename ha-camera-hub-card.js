const VERSION = "0.1.0";

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
    this._accCard = null;
    this._accCreating = false;
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
    if (this._accCard) this._accCard.hass = hass;
    else this._ensureLiveCard();
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
    history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true }));
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

  async _ensureLiveCard() {
    if (this._accCard || this._accCreating || !this._hass) return;
    this._accCreating = true;
    try {
      const helpers = await window.loadCardHelpers();
      const cameras = this._cameras.map((cam) => {
        const triggerEntities = [cam.motion_entity];
        if (cam.ai) {
          triggerEntities.push(
            `binary_sensor.${cam.key}_person_detected`,
            `binary_sensor.${cam.key}_animal_detected`,
            `binary_sensor.${cam.key}_vehicle_detected`,
            `binary_sensor.${cam.key}_object_detected`,
          );
        }
        return {
          camera_entity: cam.camera_entity,
          title: cam.name,
          icon: cam.icon || "mdi:cctv",
          triggers: { entities: triggerEntities, doorbell: !!cam.doorbell },
        };
      });
      const card = await helpers.createCardElement({
        type: "custom:advanced-camera-card",
        cameras,
        live: {
          display: { mode: "grid", grid_max_columns: 4, grid_selected_width_factor: 1 },
          auto_play: ["selected", "visible"],
          auto_mute: ["unselected", "hidden"],
        },
        view: { default: "live" },
        menu: { style: "overlay" },
      });
      card.hass = this._hass;
      this._accCard = card;
      const mount = this.shadowRoot.querySelector("[data-live-mount]");
      mount?.replaceChildren(card);
    } catch (error) {
      console.error("HA Camera Hub Card: could not load advanced-camera-card", error);
      const mount = this.shadowRoot.querySelector("[data-live-mount]");
      if (mount) mount.innerHTML = `<div class="empty">Live-visning kunne ikke indlæses. Er "Advanced Camera Card" installeret via HACS?</div>`;
    } finally {
      this._accCreating = false;
    }
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
        return `<div class="event-row" data-more="${this._esc(e.cameraEntity)}">
          <div class="event-icon ${info.cls}"><ha-icon icon="${info.icon}"></ha-icon></div>
          <div class="event-main">
            <b>${this._esc(e.cameraName)}</b>
            <span>${this._esc(info.label)} &middot; ${this._time(e.iso)} &middot; ${this._esc(this._ago(e.iso))}</span>
          </div>
          <button class="event-open" data-nav="${this._esc(this._config.protect_ingress_path)}" title="Åbn i UniFi Protect" onclick="event.stopPropagation()"><ha-icon icon="mdi:open-in-new"></ha-icon></button>
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
      .live-mount{min-height:200px;border-radius:16px;overflow:hidden}
      .empty{padding:34px 16px;text-align:center;color:var(--secondary-text-color);font-size:12.5px}
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
      <div class="panel" data-panel="live" ${this._tab === "live" ? "" : "hidden"}><div class="live-mount" data-live-mount><div class="empty">Indlæser live-visning…</div></div></div>
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
        if (this._tab === "live") this._ensureLiveCard();
      }),
    );

    if (this._hass) {
      this._ensureLiveCard();
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
  description: "Samlet kamera-hub: live-grid (via Advanced Camera Card), hændelseslog og NVR-systemstatus for UniFi Protect",
  preview: true,
});
console.info(
  `%c HA CAMERA HUB CARD %c v${VERSION} `,
  "color:#fff;background:#2563eb;font-weight:700",
  "color:#60a5fa;background:#0f172a",
);
