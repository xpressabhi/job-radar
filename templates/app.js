// Client-side filtering for the server-rendered job list. Progressive enhancement:
// without JS every row is visible and the filter bar stays hidden.
(() => {
  const bar = document.getElementById("filters");
  const list = document.getElementById("jobs");
  const count = document.getElementById("count");
  if (!bar || !list || !count) return;
  bar.hidden = false;
  count.hidden = false;

  const rows = [...list.querySelectorAll(".job")];
  const byId = (id) => document.getElementById(id);
  const state = { category: "", city: "", mode: "", company: "", recency: "", q: "" };

  const cities = new Set();
  const companies = new Set();
  for (const row of rows) {
    row.dataset.cities.split("|").filter(Boolean).forEach((c) => cities.add(c));
    if (row.dataset.company) companies.add(row.dataset.company);
  }
  const fill = (select, values) => {
    for (const v of [...values].sort()) {
      const opt = document.createElement("option");
      opt.value = v.toLowerCase();
      opt.textContent = select.id === "f-city" ? v.replace(/\b\w/g, (m) => m.toUpperCase()) : v;
      select.appendChild(opt);
    }
  };
  fill(byId("f-city"), cities);
  fill(byId("f-company"), companies);

  const apply = () => {
    const cutoff = state.recency ? Date.now() - Number(state.recency) * 864e5 : null;
    let visible = 0;
    for (const row of rows) {
      const seen = Date.parse(row.dataset.seen || "") || 0;
      const ok =
        (!state.category || row.dataset.category === state.category) &&
        (!state.city || row.dataset.cities.includes(state.city)) &&
        (!state.mode || row.dataset.mode === state.mode) &&
        (!state.company || row.dataset.company.toLowerCase() === state.company) &&
        (!cutoff || seen >= cutoff) &&
        (!state.q || row.dataset.search.includes(state.q));
      row.classList.toggle("hidden", !ok);
      if (ok) visible++;
    }
    count.textContent = `${visible} of ${rows.length} roles shown`;
  };

  for (const select of bar.querySelectorAll("select")) {
    select.addEventListener("change", () => {
      state[select.dataset.filter] = select.value;
      apply();
    });
  }
  const search = byId("f-search");
  search.addEventListener("input", () => {
    state.q = search.value.trim().toLowerCase();
    apply();
  });
  byId("f-clear").addEventListener("click", () => {
    state.category = state.city = state.mode = state.company = state.recency = state.q = "";
    for (const select of bar.querySelectorAll("select")) select.value = "";
    search.value = "";
    apply();
  });
  for (const preset of document.querySelectorAll(".presets button[data-preset]")) {
    preset.addEventListener("click", () => {
      const value = preset.dataset.preset;
      state.category = state.category === value ? "" : value;
      byId("f-category").value = state.category;
      apply();
    });
  }
  apply();
})();
