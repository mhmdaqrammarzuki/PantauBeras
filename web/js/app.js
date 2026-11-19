(function () {
  const {
    apiGet,
    formatInt,
    formatRp,
    formatRpDecimal,
    formatPct,
    formatDateId,
    badgeHtml,
    escapeHtml,
    renderLoading,
    renderError,
    renderEmpty,
    renderStepSparkline,
    renderTrendsChart,
    renderForecastChart,
    renderSulawesiMap,
    PROVINCE_COLOR_VARS,
    PROVINCE_SHORT,
  } = window.PBS;

  const ALL_PROVINCES = [
    "Gorontalo",
    "Sulawesi Barat",
    "Sulawesi Selatan",
    "Sulawesi Tengah",
    "Sulawesi Tenggara",
    "Sulawesi Utara",
  ];

  const PAGE_META = {
    beranda: {
      title: "Pemantauan Harga Beras Sulawesi",
      subtitle: "Ringkasan harga eceran & produsen per kilogram di enam provinsi Sulawesi.",
    },
    tren: {
      title: "Tren Pergerakan Harga Beras",
      subtitle: "Dinamika harga lintas provinsi menurut rentang waktu dan agregasi pelaporan.",
    },
    bandingkan: {
      title: "Perbandingan Wilayah & Margin Pasokan",
      subtitle: "Peringkat harga regional dan selisih dari tingkat produsen ke pasar eceran.",
    },
    prakiraan: {
      title: "Prakiraan Harga 4 sampai 8 Minggu",
      subtitle: "Evaluasi uji kronologis Moving Average 4W, Seasonal Naive, dan ARIMA(1,1,0).",
    },
    kualitas: {
      title: "Kualitas Data & Catatan Anomali",
      subtitle: "Rekam hari tanpa pelaporan serta lonjakan harian di atas 10% yang tetap disimpan.",
    },
    unduh: {
      title: "Ekspor Dataset Terverifikasi",
      subtitle: "Atur cakupan wilayah, tanggal, dan bentuk tabel CSV sebelum mengunduh.",
    },
  };

  const state = {
    route: "beranda",
    segment: "modern",
    theme: localStorage.getItem("pbs_theme") === "dark" ? "dark" : "light",
    collapsed: localStorage.getItem("pbs_collapsed") === "1",
    meta: null,
    trends: {
      provinces: ["Sulawesi Tengah", "Gorontalo", "Sulawesi Selatan", "Sulawesi Barat"],
      agg: "monthly",
      range: "1y",
      showMa4: true,
      showAnomalies: true,
    },
    compare: {
      date: "2026-02-12",
      selectedProvince: "Sulawesi Tengah",
    },
    forecasts: {
      province: "Sulawesi Tengah",
      horizon: 4,
      model: "arima_110",
    },
    quality: {
      province: "all",
    },
    exportCfg: {
      segment: "modern",
      provinces: [...ALL_PROVINCES],
      from: "2022-01-01",
      to: "2026-02-12",
      shape: "long",
      includeFlags: true,
    },
  };

  const els = {
    shell: document.getElementById("app-shell"),
    sidebar: document.getElementById("app-sidebar"),
    backdrop: document.getElementById("drawer-backdrop"),
    menuBtn: document.getElementById("mobile-menu-btn"),
    drawerCloseBtn: document.getElementById("drawer-close-btn"),
    collapseBtn: document.getElementById("sidebar-collapse-btn"),
    themeDesktop: document.getElementById("theme-toggle-desktop"),
    themeMobile: document.getElementById("theme-toggle-mobile"),
    pageTitle: document.getElementById("page-title"),
    pageSubtitle: document.getElementById("page-subtitle"),
    segToolbar: document.getElementById("segment-toolbar"),
    periodNote: document.getElementById("dataset-period-note"),
    viewRoot: document.getElementById("view-root"),
  };

  function applyTheme(theme) {
    state.theme = theme;
    localStorage.setItem("pbs_theme", theme);
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    const label = theme === "dark" ? "Mode Terang" : "Mode Gelap";
    if (els.themeDesktop) els.themeDesktop.textContent = label;
    if (els.themeMobile) els.themeMobile.textContent = label;
  }

  function toggleTheme() {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  }

  function applySidebarCollapsed(collapsed) {
    state.collapsed = collapsed;
    localStorage.setItem("pbs_collapsed", collapsed ? "1" : "0");
    els.shell.classList.toggle("is-collapsed", collapsed);
    if (els.collapseBtn) {
      els.collapseBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
  }

  function openMobileDrawer() {
    els.sidebar.classList.add("is-open");
    els.backdrop.hidden = false;
    els.menuBtn.setAttribute("aria-expanded", "true");
    els.drawerCloseBtn.focus();
  }

  function closeMobileDrawer(restoreFocus = true) {
    if (!els.sidebar.classList.contains("is-open")) return;
    els.sidebar.classList.remove("is-open");
    els.backdrop.hidden = true;
    els.menuBtn.setAttribute("aria-expanded", "false");
    if (restoreFocus) els.menuBtn.focus();
  }

  function syncNavAndSegmentUI() {
    document.querySelectorAll(".nav-item, .bottom-tab").forEach((link) => {
      const active = link.getAttribute("data-route") === state.route;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });

    document.querySelectorAll('#segment-toolbar [data-segment]').forEach((btn) => {
      const active = btn.getAttribute("data-segment") === state.segment;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });

    const meta = PAGE_META[state.route] || PAGE_META.beranda;
    els.pageTitle.textContent = meta.title;
    els.pageSubtitle.textContent = meta.subtitle;
    els.segToolbar.hidden = false;
    document.title = `${meta.title} | Pantau Beras Sulawesi`;
  }

  function resolveRouteFromHash() {
    const raw = (window.location.hash || "#beranda").replace(/^#\/?/, "").trim();
    return PAGE_META[raw] ? raw : "beranda";
  }

  function navigateTo(route) {
    if (!PAGE_META[route]) route = "beranda";
    if (window.location.hash !== `#${route}`) {
      window.location.hash = `#${route}`;
    } else {
      state.route = route;
      renderCurrentRoute();
    }
  }

  function provinceStatusBadge(prov) {
    if (prov.pct_30d > 1.0) {
      return badgeHtml("alert", `Naik ${formatPct(prov.pct_30d)}`, "up");
    }
    if (prov.pct_30d < -0.5) {
      return badgeHtml("success", `Turun ${formatPct(prov.pct_30d)}`, "down");
    }
    return badgeHtml("neutral", "Tetap 30h", "dot");
  }

  async function renderBeranda() {
    renderLoading(els.viewRoot, "Memuat ringkasan harga beras 6 provinsi...");
    try {
      const data = await apiGet(`/api/overview?segment=${encodeURIComponent(state.segment)}`);
      const d = data.disparity;
      if (els.periodNote && data.latest_date) {
        els.periodNote.textContent = `Data ${formatDateId(data.latest_date)}`;
      }

      const sortedProvinces = [...data.provinces].sort((a, b) => b.price_idr - a.price_idr);
      const minP = d.cheapest.price_idr;
      const maxP = d.most_expensive.price_idr;
      const spanP = Math.max(100, maxP - minP);

      const spectrumDotsHtml = data.provinces.map((p) => {
        const pct = ((p.price_idr - minP) / spanP) * 100;
        const clamped = Math.max(2, Math.min(98, pct)).toFixed(1);
        const col = PROVINCE_COLOR_VARS[p.province] || "var(--brand-primary)";
        const shortName = PROVINCE_SHORT[p.province] || p.province;
        return `<span class="spectrum-dot" style="left: ${clamped}%; background: ${col}" title="${escapeHtml(shortName)}: ${escapeHtml(formatRp(p.price_idr))}"></span>`;
      }).join("");

      const alertHtml = data.alerts.length
        ? `
          <div class="alert-rail">
            <div>
              <div class="card-header">
                <h2 class="card-title">Peringatan Lonjakan</h2>
                ${badgeHtml("alert", `${data.alerts.length} Peringatan`, "alert")}
              </div>
              <ul class="alert-list" style="margin-top: 8px;">
                ${data.alerts.map((a) => `<li><strong>${escapeHtml(a.province)}:</strong> ${escapeHtml(a.message)}</li>`).join("")}
              </ul>
            </div>
            <button type="button" class="btn btn-secondary" data-go="kualitas">Periksa Kualitas Data</button>
          </div>
        `
        : `
          <div class="alert-rail">
            <div>
              <div class="card-header">
                <h2 class="card-title">Pantauan 30 Hari</h2>
                ${badgeHtml("success", "Tanpa Lonjakan >10%", "check")}
              </div>
              <p class="card-desc">
                Seluruh 6 provinsi tidak mencatat lonjakan harian di atas 10% dalam 30 hari terakhir.
                Tercatat ${formatInt(data.historical_anomalies_count)} catatan anomali historis di arsip segmen ini.
              </p>
            </div>
            <button type="button" class="btn btn-secondary" data-go="kualitas">Tinjau ${formatInt(data.historical_anomalies_count)} Catatan Historis</button>
          </div>
        `;

      const ledgerRowsHtml = sortedProvinces.map((p, idx) => {
        const colVar = PROVINCE_COLOR_VARS[p.province] || "var(--brand-primary)";
        return `
          <button
            type="button"
            class="ledger-row"
            data-inspect-trend="${escapeHtml(p.province)}"
            aria-label="Lihat tren ${escapeHtml(p.province)}, harga ${escapeHtml(formatRp(p.price_idr))} per kg"
          >
            <span class="ledger-cell-prov">
              <span class="ledger-rank">${idx + 1}</span>
              <span class="ledger-swatch" style="background: ${colVar}" aria-hidden="true"></span>
              <span class="ledger-prov-text">
                <span class="ledger-prov-name">${escapeHtml(p.province)}</span>
                ${provinceStatusBadge(p)}
              </span>
            </span>
            <span class="ledger-cell-price">${escapeHtml(formatRp(p.price_idr))}</span>
            <span class="ledger-cell-deltas">
              <span>30h ${escapeHtml(formatPct(p.pct_30d))}</span>
              <span>MoM ${escapeHtml(formatPct(p.mom_pct))}</span>
            </span>
            <span class="ledger-cell-spark">${renderStepSparkline(p.spark_90d, colVar)}</span>
            <span class="ledger-cell-freq">${formatInt(p.change_days)}/${formatInt(p.total_days)} hr</span>
          </button>
        `;
      }).join("");

      els.viewRoot.innerHTML = `
        <section class="disparity-hero" aria-label="Ringkasan disparitas harga regional">
          <div class="disparity-lead">
            <div class="disparity-headline-row">
              <div>
                <div class="field-label">DISPARITAS HARGA REGIONAL</div>
                <div class="kpi-xl">${escapeHtml(formatRp(d.gap_idr))} <span class="section-note">/ kg</span></div>
              </div>
              ${badgeHtml("neutral", `${String(d.gap_pct).replace(".", ",")}% selisih`, "dot")}
            </div>

            <div class="spectrum-wrap">
              <div class="spectrum-rail" aria-hidden="true">
                <div class="spectrum-track"></div>
                ${spectrumDotsHtml}
              </div>
              <div class="spectrum-endpoints">
                <div class="spectrum-end">
                  <span class="spectrum-end-label">TERMURAH · ${escapeHtml(d.cheapest.province.toUpperCase())}</span>
                  <span class="font-mono" style="font-weight: 700; color: var(--status-success);">${escapeHtml(formatRp(d.cheapest.price_idr))}</span>
                </div>
                <div class="spectrum-end is-right">
                  <span class="spectrum-end-label">TERMAHAL · ${escapeHtml(d.most_expensive.province.toUpperCase())}</span>
                  <span class="font-mono" style="font-weight: 700; color: var(--status-alert-text);">${escapeHtml(formatRp(d.most_expensive.price_idr))}</span>
                </div>
              </div>
            </div>
          </div>

          ${alertHtml}
        </section>

        <section class="editorial-section" aria-label="Papan peringkat harga provinsi">
          <div class="section-bar">
            <h2 class="section-heading">Peringkat Harga 6 Provinsi (${escapeHtml(data.segment.label)})</h2>
            <span class="section-note">Urutan harga tertinggi · Kurva langkah 90 hari</span>
          </div>

          <div class="ledger-shell">
            <div class="ledger-head" aria-hidden="true">
              <span>Provinsi &amp; Arah 30 Hari</span>
              <span class="ledger-head-num">Harga / kg</span>
              <span>Perubahan</span>
              <span>Tren 90 Hari</span>
              <span class="ledger-head-num">Frekuensi Ubah</span>
            </div>
            <div>${ledgerRowsHtml}</div>
          </div>
        </section>
      `;

      els.viewRoot.querySelectorAll("[data-go]").forEach((btn) => {
        btn.addEventListener("click", () => navigateTo(btn.getAttribute("data-go")));
      });
      els.viewRoot.querySelectorAll("[data-inspect-trend]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.trends.provinces = [btn.getAttribute("data-inspect-trend")];
          navigateTo("tren");
        });
      });
    } catch (err) {
      renderError(els.viewRoot, err.message, renderBeranda);
    }
  }

  async function renderTren() {
    renderLoading(els.viewRoot, "Memuat seri waktu dan rata-rata bergerak...");
    try {
      const t = state.trends;
      const qProvs = t.provinces.join(",");
      const data = await apiGet(
        `/api/trends?segment=${encodeURIComponent(state.segment)}&provinces=${encodeURIComponent(qProvs)}&agg=${encodeURIComponent(t.agg)}&range=${encodeURIComponent(t.range)}`
      );

      const chipsHtml = ALL_PROVINCES.map((p) => {
        const active = t.provinces.includes(p);
        const col = PROVINCE_COLOR_VARS[p] || "var(--brand-primary)";
        return `
          <button
            type="button"
            class="chip-btn ${active ? "is-active" : ""}"
            aria-pressed="${active ? "true" : "false"}"
            data-trend-prov="${escapeHtml(p)}"
          >
            <span class="color-dot" style="background: ${col}" aria-hidden="true"></span>
            <span>${escapeHtml(p)}</span>
          </button>
        `;
      }).join("");

      const sortedSummary = [...data.summary].sort((a, b) => b.latest_idr - a.latest_idr);
      const topProv = sortedSummary[0];
      const botProv = sortedSummary[sortedSummary.length - 1];
      const chartHeadline = sortedSummary.length > 1
        ? `${PROVINCE_SHORT[topProv.province] || topProv.province} tertinggi (${formatRp(topProv.latest_idr)}), selisih ${formatRp(topProv.latest_idr - botProv.latest_idr)} dari ${PROVINCE_SHORT[botProv.province] || botProv.province}`
        : `${topProv.province}: ${formatRp(topProv.latest_idr)} / kg`;

      const summaryCards = data.summary.map((s) => `
        <div class="card">
          <div class="field-label">${escapeHtml(s.province)}</div>
          <div class="kpi-md">${escapeHtml(formatRp(s.latest_idr))}</div>
          <div class="section-note font-mono">Min ${escapeHtml(formatRp(s.min_idr))} · Maks ${escapeHtml(formatRp(s.max_idr))}</div>
          <div class="section-note">Berubah ${formatInt(s.change_days)} dari ${formatInt(s.total_days)} hari</div>
        </div>
      `).join("");

      els.viewRoot.innerHTML = `
        <div class="filter-strip">
          <div class="field-group">
            <span class="field-label">Provinsi Ditampilkan (1-6)</span>
            <div class="chip-list">${chipsHtml}</div>
          </div>

          <div class="controls-grid">
            <div class="field-group">
              <span class="field-label">Rentang</span>
              <div class="segment-group" role="group" aria-label="Rentang waktu grafik">
                ${[["3m", "3 Bulan"], ["1y", "1 Tahun"], ["all", "2022-2026"]].map(([id, lbl]) => `
                  <button type="button" class="seg-btn ${t.range === id ? "is-active" : ""}" aria-pressed="${t.range === id ? "true" : "false"}" data-trend-range="${id}">${lbl}</button>
                `).join("")}
              </div>
            </div>

            <div class="field-group">
              <span class="field-label">Agregasi</span>
              <div class="segment-group" role="group" aria-label="Mode agregasi data">
                ${[["daily", "Harian"], ["weekly", "Mingguan"], ["monthly", "Bulanan"]].map(([id, lbl]) => `
                  <button type="button" class="seg-btn ${t.agg === id ? "is-active" : ""}" aria-pressed="${t.agg === id ? "true" : "false"}" data-trend-agg="${id}">${lbl}</button>
                `).join("")}
              </div>
            </div>

            <div class="field-group">
              <span class="field-label">Lapisan</span>
              <div class="chip-list">
                <label class="check-label" for="toggle-ma4">
                  <input type="checkbox" id="toggle-ma4" ${t.showMa4 ? "checked" : ""}>
                  <span>MA 4 Minggu</span>
                </label>
                <label class="check-label" for="toggle-anom">
                  <input type="checkbox" id="toggle-anom" ${t.showAnomalies ? "checked" : ""}>
                  <span>Penanda Kualitas</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">${escapeHtml(chartHeadline)}</h2>
              <p class="card-desc">${escapeHtml(data.segment.label)} · ${escapeHtml(formatDateId(data.start_date))} s/d ${escapeHtml(formatDateId(data.end_date))}</p>
            </div>
          </div>
          <div id="trend-chart-mount"></div>
        </div>

        <section class="editorial-section">
          <div class="section-bar">
            <h2 class="section-heading">Ringkasan Rentang Terpilih</h2>
            <span class="section-note">Harga minimum, maksimum, dan hari perubahan</span>
          </div>
          <div class="grid-3col">${summaryCards}</div>
        </section>
      `;

      const chartMount = document.getElementById("trend-chart-mount");
      renderTrendsChart(chartMount, data, {
        showMa4: t.showMa4,
        showAnomalies: t.showAnomalies,
        onReset: () => {
          state.trends.provinces = ["Sulawesi Tengah", "Gorontalo", "Sulawesi Selatan", "Sulawesi Barat"];
          state.trends.range = "1y";
          state.trends.agg = "monthly";
          renderTren();
        },
      });

      els.viewRoot.querySelectorAll("[data-trend-prov]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const prov = btn.getAttribute("data-trend-prov");
          const exists = state.trends.provinces.includes(prov);
          if (exists && state.trends.provinces.length > 1) {
            state.trends.provinces = state.trends.provinces.filter((p) => p !== prov);
            renderTren();
          } else if (!exists) {
            state.trends.provinces = ALL_PROVINCES.filter((p) => state.trends.provinces.includes(p) || p === prov);
            renderTren();
          }
        });
      });

      els.viewRoot.querySelectorAll("[data-trend-range]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.trends.range = btn.getAttribute("data-trend-range");
          renderTren();
        });
      });

      els.viewRoot.querySelectorAll("[data-trend-agg]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.trends.agg = btn.getAttribute("data-trend-agg");
          renderTren();
        });
      });

      document.getElementById("toggle-ma4").addEventListener("change", (ev) => {
        state.trends.showMa4 = ev.target.checked;
        renderTren();
      });
      document.getElementById("toggle-anom").addEventListener("change", (ev) => {
        state.trends.showAnomalies = ev.target.checked;
        renderTren();
      });
    } catch (err) {
      renderError(els.viewRoot, err.message, renderTren);
    }
  }

  async function renderBandingkan() {
    renderLoading(els.viewRoot, "Memuat peringkat wilayah dan margin pasokan...");
    try {
      const cmp = state.compare;
      const data = await apiGet(
        `/api/compare?segment=${encodeURIComponent(state.segment)}&date=${encodeURIComponent(cmp.date)}`
      );

      const vals = data.rankings.map((r) => r.price_idr);
      const rawMin = Math.min(...vals);
      const rawMax = Math.max(...vals);
      const axisMin = Math.max(0, Math.floor((rawMin - 1500) / 2000) * 2000);
      const axisMax = Math.ceil((rawMax + 500) / 2000) * 2000;
      const axisSpan = Math.max(2000, axisMax - axisMin);
      const midAxis = Math.round((axisMin + axisMax) / 2);

      const barsHtml = data.rankings.map((r) => {
        const col = PROVINCE_COLOR_VARS[r.province] || "var(--brand-primary)";
        const pct = Math.max(4, Math.min(100, ((r.price_idr - axisMin) / axisSpan) * 100));
        const isSel = cmp.selectedProvince === r.province;
        return `
          <button
            type="button"
            class="bar-row ${isSel ? "is-selected" : ""}"
            data-bar-prov="${escapeHtml(r.province)}"
            aria-pressed="${isSel ? "true" : "false"}"
          >
            <span class="bar-prov">${r.rank}. ${escapeHtml(r.province)}</span>
            <span class="bar-track" aria-hidden="true">
              <span class="bar-fill" style="display: block; width: ${pct.toFixed(1)}%; background: ${col};"></span>
            </span>
            <span class="bar-val">${escapeHtml(formatRp(r.price_idr))}</span>
          </button>
        `;
      }).join("");

      const marginRowsHtml = data.supply_chain_margins.map((m) => `
        <tr class="${cmp.selectedProvince === m.province ? "is-highlighted" : ""}">
          <td><strong>${escapeHtml(m.province)}</strong></td>
          <td class="num-cell">${escapeHtml(formatRp(m.produsen_idr))}</td>
          <td class="num-cell">${escapeHtml(formatRp(m.tradisional_idr))}</td>
          <td class="num-cell"><strong>${escapeHtml(formatRp(m.modern_idr))}</strong></td>
          <td class="num-cell text-brand">+${escapeHtml(formatRp(m.spread_idr))} (${String(m.spread_pct).replace(".", ",")}%)</td>
        </tr>
      `).join("");

      const dateBadge = data.is_imputed_date
        ? badgeHtml("info", "Diisi dari hari sebelumnya", "dot")
        : badgeHtml("success", "Data teramati", "check");

      els.viewRoot.innerHTML = `
        <div class="filter-strip">
          <div class="controls-grid" style="justify-content: space-between; align-items: center;">
            <div class="controls-grid" style="align-items: center;">
              <div class="field-group">
                <label class="field-label" for="compare-date-input">Tanggal Evaluasi (${escapeHtml(formatDateId(data.date))})</label>
                <input
                  type="date"
                  id="compare-date-input"
                  class="input-control font-mono"
                  value="${escapeHtml(data.date)}"
                  min="${escapeHtml(data.min_date)}"
                  max="${escapeHtml(data.max_date)}"
                >
              </div>
              <div class="field-group">
                <span class="field-label">Status Pelaporan</span>
                ${dateBadge}
              </div>
            </div>
            <div>
              <div class="field-label">Disparitas Regional</div>
              <div class="kpi-md text-alert">${escapeHtml(formatRp(data.disparity_idr))} / kg (${String(data.disparity_pct).replace(".", ",")}%)</div>
            </div>
          </div>
        </div>

        <div class="grid-compare-split">
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Peringkat Harga (${escapeHtml(formatDateId(data.date))})</h2>
                <p class="card-desc">Skala sumbu ${escapeHtml(formatRp(axisMin))} sampai ${escapeHtml(formatRp(axisMax))}.</p>
              </div>
            </div>
            <div>
              ${barsHtml}
              <div class="bar-axis">
                <span class="bar-axis-spacer"></span>
                <div class="bar-axis-ticks">
                  <span>${escapeHtml(formatRp(axisMin))}</span>
                  <span>${escapeHtml(formatRp(midAxis))}</span>
                  <span>${escapeHtml(formatRp(axisMax))}</span>
                </div>
                <span class="bar-axis-end"></span>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <h2 class="card-title">Peta Sebaran Sulawesi</h2>
            </div>
            <div id="sulawesi-map-mount"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Margin Rantai Pasok (${escapeHtml(formatDateId(data.date))})</h2>
              <p class="card-desc">Perbandingan harga tingkat produsen, pasar tradisional, dan pasar modern di tanggal yang sama.</p>
            </div>
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Provinsi</th>
                  <th>Produsen</th>
                  <th>Tradisional</th>
                  <th>Modern</th>
                  <th>Selisih Hulu-Hilir</th>
                </tr>
              </thead>
              <tbody>${marginRowsHtml}</tbody>
            </table>
          </div>
        </div>
      `;

      const mapMount = document.getElementById("sulawesi-map-mount");
      renderSulawesiMap(mapMount, data.rankings, state.compare.selectedProvince, (prov) => {
        state.compare.selectedProvince = prov;
        renderBandingkan();
      });

      els.viewRoot.querySelectorAll("[data-bar-prov]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.compare.selectedProvince = btn.getAttribute("data-bar-prov");
          renderBandingkan();
        });
      });

      document.getElementById("compare-date-input").addEventListener("change", (ev) => {
        if (ev.target.value) {
          state.compare.date = ev.target.value;
          renderBandingkan();
        }
      });
    } catch (err) {
      renderError(els.viewRoot, err.message, renderBandingkan);
    }
  }

  async function renderPrakiraan() {
    renderLoading(els.viewRoot, "Memuat proyeksi harga dan evaluasi model...");
    try {
      const f = state.forecasts;
      const data = await apiGet(
        `/api/forecasts?segment=${encodeURIComponent(state.segment)}&province=${encodeURIComponent(f.province)}&horizon=${f.horizon}&model=${encodeURIComponent(f.model)}`
      );

      const selEval = data.model_comparison.find((m) => m.model_name === f.model) || data.model_comparison[0];
      const finalPt = data.forecast_points[data.forecast_points.length - 1];

      const evalRowsHtml = data.model_comparison.map((m) => `
        <tr class="${m.is_selected ? "is-highlighted" : ""}">
          <td>
            <strong>${escapeHtml(m.model_label)}</strong>
            ${m.is_best_mae ? ` ${badgeHtml("success", "MAE Terendah", "check")}` : ""}
          </td>
          <td class="num-cell">${escapeHtml(formatRpDecimal(m.eval_mae, 2))}</td>
          <td class="num-cell">${String(m.eval_mape.toFixed(2)).replace(".", ",")}%</td>
          <td class="num-cell">${escapeHtml(formatRp(m.final_pred_idr))}</td>
          <td class="num-cell">${escapeHtml(formatRp(m.final_lower_idr))} - ${escapeHtml(formatRp(m.final_upper_idr))}</td>
        </tr>
      `).join("");

      els.viewRoot.innerHTML = `
        <div class="filter-strip">
          <div class="controls-grid">
            <div class="field-group">
              <label class="field-label" for="fc-prov-select">Provinsi</label>
              <select id="fc-prov-select" class="select-control">
                ${ALL_PROVINCES.map((p) => `<option value="${escapeHtml(p)}" ${p === f.province ? "selected" : ""}>${escapeHtml(p)}</option>`).join("")}
              </select>
            </div>

            <div class="field-group">
              <span class="field-label">Horizon</span>
              <div class="segment-group" role="group" aria-label="Horizon minggu">
                ${[4, 8].map((hVal) => `
                  <button type="button" class="seg-btn ${f.horizon === hVal ? "is-active" : ""}" aria-pressed="${f.horizon === hVal ? "true" : "false"}" data-fc-horizon="${hVal}">${hVal} Minggu</button>
                `).join("")}
              </div>
            </div>

            <div class="field-group">
              <span class="field-label">Model</span>
              <div class="segment-group" role="group" aria-label="Pilih model prakiraan">
                ${[
                  ["arima_110", "ARIMA(1,1,0)"],
                  ["seasonal_naive", "Seasonal Naive"],
                  ["moving_average_4w", "Moving Avg 4W"],
                ].map(([mKey, mLbl]) => `
                  <button type="button" class="seg-btn ${f.model === mKey ? "is-active" : ""}" aria-pressed="${f.model === mKey ? "true" : "false"}" data-fc-model="${mKey}">${mLbl}</button>
                `).join("")}
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">${escapeHtml(data.province)}: Proyeksi +${f.horizon} Minggu di ${escapeHtml(formatRp(finalPt.predicted_idr))}</h2>
              <p class="card-desc">
                Target ${escapeHtml(formatDateId(finalPt.target_date))} · Rentang keyakinan 90%: ${escapeHtml(formatRp(finalPt.lower_idr))} sampai ${escapeHtml(formatRp(finalPt.upper_idr))}.
              </p>
            </div>
            ${badgeHtml("success", `${data.selected_model_label} · MAPE ${String(selEval.eval_mape.toFixed(2)).replace(".", ",")}%`, "dot")}
          </div>
          <div id="fc-chart-mount"></div>
        </div>

        <div class="grid-forecast-split">
          <div class="card">
            <h2 class="card-title">Uji Kronologis (Jan 2025 - Feb 2026)</h2>
            <div class="table-scroll">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>MAE (Rp/kg)</th>
                    <th>MAPE</th>
                    <th>Prediksi +${f.horizon}M</th>
                    <th>Interval 90%</th>
                  </tr>
                </thead>
                <tbody>${evalRowsHtml}</tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <h2 class="card-title">Catatan Seri Harga</h2>
            <p class="card-desc">
              Pada segmen ini, harga ${escapeHtml(data.province)} berubah pada <strong>${formatInt(data.change_days)}</strong> dari ${formatInt(data.total_days)} hari kalender sehingga kurvanya bergerak bertahap.
            </p>
            <p class="card-desc">
              Angka prakiraan adalah estimasi statistik dari riwayat mingguan, bukan jaminan harga transaksi di lapangan.
            </p>
          </div>
        </div>
      `;

      renderForecastChart(document.getElementById("fc-chart-mount"), data);

      document.getElementById("fc-prov-select").addEventListener("change", (ev) => {
        state.forecasts.province = ev.target.value;
        renderPrakiraan();
      });
      els.viewRoot.querySelectorAll("[data-fc-horizon]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.forecasts.horizon = Number(btn.getAttribute("data-fc-horizon"));
          renderPrakiraan();
        });
      });
      els.viewRoot.querySelectorAll("[data-fc-model]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.forecasts.model = btn.getAttribute("data-fc-model");
          renderPrakiraan();
        });
      });
    } catch (err) {
      renderError(els.viewRoot, err.message, renderPrakiraan);
    }
  }

  async function renderKualitas() {
    renderLoading(els.viewRoot, "Memuat rekam kelengkapan tanggal dan anomali...");
    try {
      const q = state.quality;
      const data = await apiGet(
        `/api/quality?segment=${encodeURIComponent(state.segment)}&province=${encodeURIComponent(q.province)}`
      );
      const etl = data.etl;

      const r3Html = q.province === "all"
        ? `
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Sulsel</th>
                  <th>Sulteng</th>
                  <th>Cakupan</th>
                  <th>Tindak Lanjut</th>
                </tr>
              </thead>
              <tbody>
                ${data.imputed_rows.map((r) => `
                  <tr>
                    <td class="num-cell">${escapeHtml(formatDateId(r.price_date))}</td>
                    <td class="num-cell">${escapeHtml(formatRp(r.sulsel_idr))}</td>
                    <td class="num-cell">${escapeHtml(formatRp(r.sulteng_idr))}</td>
                    <td>${badgeHtml("info", `${r.province_rows} prov`, "dot")}</td>
                    <td><button type="button" class="btn btn-secondary btn-table-link" data-jump-date="${escapeHtml(r.price_date)}">Bandingkan</button></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `
        : `
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Provinsi</th>
                  <th>Harga Diisi</th>
                  <th>Tindak Lanjut</th>
                </tr>
              </thead>
              <tbody>
                ${data.imputed_rows.map((r) => `
                  <tr>
                    <td class="num-cell">${escapeHtml(formatDateId(r.price_date))}</td>
                    <td>${escapeHtml(r.province)}</td>
                    <td class="num-cell">${escapeHtml(formatRp(r.price_idr))}</td>
                    <td><button type="button" class="btn btn-secondary btn-table-link" data-jump-date="${escapeHtml(r.price_date)}">Bandingkan</button></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `;

      els.viewRoot.innerHTML = `
        <div class="filter-strip">
          <div class="controls-grid" style="align-items: center; justify-content: space-between;">
            <div class="field-group">
              <label class="field-label" for="quality-prov-select">Saring Provinsi</label>
              <select id="quality-prov-select" class="select-control">
                <option value="all" ${q.province === "all" ? "selected" : ""}>Semua 6 Provinsi Sulawesi</option>
                ${ALL_PROVINCES.map((p) => `<option value="${escapeHtml(p)}" ${q.province === p ? "selected" : ""}>${escapeHtml(p)}</option>`).join("")}
              </select>
            </div>
            <div class="section-note font-mono">
              ${escapeHtml(etl.label)} · ${escapeHtml(formatDateId(etl.min_date))} s/d ${escapeHtml(formatDateId(etl.max_date))}
            </div>
          </div>
        </div>

        <div class="grid-3col">
          <div class="card">
            <span class="field-label">TOTAL OBSERVASI</span>
            <span class="kpi-lg">${formatInt(etl.rows_long)} baris</span>
            <span class="section-note">6 provinsi x ${formatInt(etl.calendar_days)} hari kalender</span>
          </div>
          <div class="card">
            <span class="field-label">HARI TANPA LAPORAN</span>
            <span class="kpi-lg">${formatInt(etl.rows_imputed)} baris</span>
            ${badgeHtml("info", `${formatInt(data.imputed_dates_count)} tanggal diisi otomatis`, "dot")}
          </div>
          <div class="card">
            <span class="field-label">LONJAKAN HARIAN &gt; 10%</span>
            <span class="kpi-lg">${formatInt(data.anomalies_count)} kejadian</span>
            ${badgeHtml(data.anomalies_count > 0 ? "alert" : "success", data.anomalies_count > 0 ? "Perlu Verifikasi" : "Nihil", data.anomalies_count > 0 ? "alert" : "check")}
          </div>
        </div>

        <div class="grid-2col">
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Hari Tanpa Pelaporan (${formatInt(data.imputed_dates_count)} Tanggal)</h2>
                <p class="card-desc">Kekosongan tanggal diisi harga hari sebelumnya agar seri kalender utuh dan tetap ditandai.</p>
              </div>
            </div>
            ${r3Html}
          </div>

          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Lonjakan Harian di Atas 10%</h2>
                <p class="card-desc">Kenaikan atau penurunan ekstrem tetap dipertahankan dengan status perlu verifikasi.</p>
              </div>
            </div>
            <div id="r5-anomaly-mount"></div>
          </div>
        </div>

        <div class="card">
          <h2 class="card-title">Catatan Temuan Data</h2>
          <ul class="alert-list">
            ${data.investigation_notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}
          </ul>
          <p class="scope-footnote">
            Cakupan sumber: PIHPS Bank Indonesia (1 Jan 2022 s/d 12 Feb 2026) untuk komoditas beras tingkat provinsi tanpa rincian kualitas/varietas.
          </p>
        </div>
      `;

      const r5Mount = document.getElementById("r5-anomaly-mount");
      if (!data.anomalies.length) {
        renderEmpty(
          r5Mount,
          "Tidak ada lonjakan > 10% pada filter ini",
          `Segmen ${etl.label} untuk ${q.province === "all" ? "Sulawesi" : q.province} tidak mencatat perubahan harian di atas 10%.`,
          "Reset Filter",
          () => {
            state.quality.province = "all";
            renderKualitas();
          }
        );
      } else {
        r5Mount.innerHTML = `
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Provinsi</th>
                  <th>Sebelum</th>
                  <th>Sesudah</th>
                  <th>&Delta; Harian</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${data.anomalies.map((a) => `
                  <tr>
                    <td class="num-cell">${escapeHtml(formatDateId(a.price_date))}</td>
                    <td>${escapeHtml(PROVINCE_SHORT[a.province] || a.province)}</td>
                    <td class="num-cell">${escapeHtml(formatRp(a.prev_price_idr))}</td>
                    <td class="num-cell"><strong>${escapeHtml(formatRp(a.price_idr))}</strong></td>
                    <td class="num-cell text-alert">${escapeHtml(formatPct(a.pct_change_daily))}</td>
                    <td>${badgeHtml("alert", "Perlu Verifikasi", "alert")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `;
      }

      document.getElementById("quality-prov-select").addEventListener("change", (ev) => {
        state.quality.province = ev.target.value;
        renderKualitas();
      });
      els.viewRoot.querySelectorAll("[data-jump-date]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.compare.date = btn.getAttribute("data-jump-date");
          navigateTo("bandingkan");
        });
      });
    } catch (err) {
      renderError(els.viewRoot, err.message, renderKualitas);
    }
  }

  async function renderUnduh() {
    renderLoading(els.viewRoot, "Menyiapkan pratinjau ekspor CSV...");
    try {
      const cfg = state.exportCfg;
      cfg.segment = state.segment;
      const provParam = cfg.provinces.length === 6 ? "all" : cfg.provinces.join(",");
      const qs = `segment=${encodeURIComponent(cfg.segment)}&provinces=${encodeURIComponent(provParam)}&from=${encodeURIComponent(cfg.from)}&to=${encodeURIComponent(cfg.to)}&shape=${encodeURIComponent(cfg.shape)}&include_flags=${cfg.includeFlags ? "1" : "0"}`;
      const prev = await apiGet(`/api/export?${qs}&preview=1`);

      els.viewRoot.innerHTML = `
        <div class="grid-export-split">
          <form class="card" id="export-form">
            <h2 class="card-title">Parameter Unduhan</h2>

            <div class="field-group">
              <label class="field-label" for="exp-segment">Segmen Pasar</label>
              <select id="exp-segment" class="select-control">
                <option value="modern" ${cfg.segment === "modern" ? "selected" : ""}>Pasar Modern</option>
                <option value="tradisional" ${cfg.segment === "tradisional" ? "selected" : ""}>Pasar Tradisional</option>
                <option value="produsen" ${cfg.segment === "produsen" ? "selected" : ""}>Tingkat Produsen</option>
              </select>
            </div>

            <div class="field-group">
              <span class="field-label">Cakupan Provinsi (minimal 1)</span>
              <div class="chip-list">
                ${ALL_PROVINCES.map((p) => `
                  <label class="check-label">
                    <input type="checkbox" name="exp_prov" value="${escapeHtml(p)}" ${cfg.provinces.includes(p) ? "checked" : ""}>
                    <span>${escapeHtml(p)}</span>
                  </label>
                `).join("")}
              </div>
            </div>

            <div class="grid-2col">
              <div class="field-group">
                <label class="field-label" for="exp-from">Dari Tanggal</label>
                <input type="date" id="exp-from" class="input-control font-mono" value="${escapeHtml(prev.start_date)}" min="2022-01-01" max="2026-02-12">
              </div>
              <div class="field-group">
                <label class="field-label" for="exp-to">Sampai Tanggal</label>
                <input type="date" id="exp-to" class="input-control font-mono" value="${escapeHtml(prev.end_date)}" min="2022-01-01" max="2026-02-12">
              </div>
            </div>

            <div class="field-group">
              <span class="field-label">Bentuk Tabel CSV</span>
              <div class="segment-group" role="group" aria-label="Bentuk tabel CSV">
                <button type="button" class="seg-btn ${cfg.shape === "long" ? "is-active" : ""}" aria-pressed="${cfg.shape === "long" ? "true" : "false"}" data-exp-shape="long">Memanjang</button>
                <button type="button" class="seg-btn ${cfg.shape === "wide" ? "is-active" : ""}" aria-pressed="${cfg.shape === "wide" ? "true" : "false"}" data-exp-shape="wide">Melebar (per Provinsi)</button>
              </div>
            </div>

            <label class="check-label" for="exp-flags">
              <input type="checkbox" id="exp-flags" ${cfg.includeFlags ? "checked" : ""}>
              <span>Sertakan penanda kualitas data</span>
            </label>

            <a class="btn btn-primary" href="/api/export?${qs}&preview=0" download="${escapeHtml(prev.filename)}" id="btn-download-csv">
              Unduh CSV (${formatInt(prev.total_rows)} baris)
            </a>
          </form>

          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Pratinjau 5 Baris Pertama</h2>
                <p class="card-desc">${formatInt(prev.total_rows)} baris siap unduh · ${escapeHtml(formatDateId(prev.start_date))} s/d ${escapeHtml(formatDateId(prev.end_date))}</p>
              </div>
              <span class="badge badge-neutral font-mono">${escapeHtml(prev.filename)}</span>
            </div>

            <div class="table-scroll">
              <table class="data-table">
                <thead>
                  <tr>${prev.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>
                </thead>
                <tbody>
                  ${prev.rows.map((row) => `
                    <tr>${row.map((cell, ci) => `<td class="${ci === 0 || ci >= 2 ? "num-cell" : ""}">${escapeHtml(cell)}</td>`).join("")}</tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;

      document.getElementById("exp-segment").addEventListener("change", (ev) => {
        state.segment = ev.target.value;
        state.exportCfg.segment = ev.target.value;
        syncNavAndSegmentUI();
        renderUnduh();
      });

      els.viewRoot.querySelectorAll('input[name="exp_prov"]').forEach((cb) => {
        cb.addEventListener("change", () => {
          const checked = [...els.viewRoot.querySelectorAll('input[name="exp_prov"]:checked')].map((el) => el.value);
          if (checked.length === 0) {
            cb.checked = true;
            return;
          }
          state.exportCfg.provinces = checked;
          renderUnduh();
        });
      });

      document.getElementById("exp-from").addEventListener("change", (ev) => {
        if (ev.target.value) {
          state.exportCfg.from = ev.target.value;
          renderUnduh();
        }
      });
      document.getElementById("exp-to").addEventListener("change", (ev) => {
        if (ev.target.value) {
          state.exportCfg.to = ev.target.value;
          renderUnduh();
        }
      });

      els.viewRoot.querySelectorAll("[data-exp-shape]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.exportCfg.shape = btn.getAttribute("data-exp-shape");
          renderUnduh();
        });
      });

      document.getElementById("exp-flags").addEventListener("change", (ev) => {
        state.exportCfg.includeFlags = ev.target.checked;
        renderUnduh();
      });
    } catch (err) {
      renderError(els.viewRoot, err.message, renderUnduh);
    }
  }

  async function renderCurrentRoute() {
    syncNavAndSegmentUI();
    closeMobileDrawer(false);
    if (state.route === "beranda") return renderBeranda();
    if (state.route === "tren") return renderTren();
    if (state.route === "bandingkan") return renderBandingkan();
    if (state.route === "prakiraan") return renderPrakiraan();
    if (state.route === "kualitas") return renderKualitas();
    if (state.route === "unduh") return renderUnduh();
    return renderBeranda();
  }

  async function bootstrap() {
    applyTheme(state.theme);
    applySidebarCollapsed(state.collapsed);

    if (els.themeDesktop) els.themeDesktop.addEventListener("click", toggleTheme);
    if (els.themeMobile) els.themeMobile.addEventListener("click", toggleTheme);
    if (els.collapseBtn) {
      els.collapseBtn.addEventListener("click", () => applySidebarCollapsed(!state.collapsed));
    }
    if (els.menuBtn) els.menuBtn.addEventListener("click", openMobileDrawer);
    if (els.drawerCloseBtn) els.drawerCloseBtn.addEventListener("click", () => closeMobileDrawer(true));
    if (els.backdrop) els.backdrop.addEventListener("click", () => closeMobileDrawer(true));

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeMobileDrawer(true);
    });

    document.querySelectorAll('#segment-toolbar [data-segment]').forEach((btn) => {
      btn.addEventListener("click", () => {
        state.segment = btn.getAttribute("data-segment");
        state.exportCfg.segment = state.segment;
        renderCurrentRoute();
      });
    });

    window.addEventListener("hashchange", () => {
      state.route = resolveRouteFromHash();
      renderCurrentRoute();
    });

    try {
      state.meta = await apiGet("/api/meta");
      const firstSeg = state.meta.segments[0];
      if (firstSeg && els.periodNote) {
        els.periodNote.textContent = `Data ${formatDateId(firstSeg.max_date)}`;
      }
    } catch (_) {
      // View loaders surface server errors explicitly
    }

    state.route = resolveRouteFromHash();
    renderCurrentRoute();
  }

  bootstrap();
})();
