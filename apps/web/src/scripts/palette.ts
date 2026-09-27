// Client-side search over /r/registry.json. Rows are server-rendered, so the
// list works without JavaScript; this only filters, reorders, and adds keys.

interface IndexEntry {
  name: string;
  type: "agent" | "skill";
  description: string;
  category?: string;
  tags: string[];
}

type Filter = "all" | IndexEntry["type"];

export function rank(entries: IndexEntry[], query: string): IndexEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return entries;
  const scored: { entry: IndexEntry; score: number }[] = [];
  for (const entry of entries) {
    const tags = entry.tags.join(" ");
    const description = entry.description.toLowerCase();
    let score = 0;
    for (const term of terms) {
      let s = 0;
      if (entry.name === term) s = 100;
      else if (entry.name.startsWith(term)) s = 60;
      else if (entry.name.includes(term)) s = 40;
      else if (entry.tags.includes(term)) s = 30;
      else if (tags.includes(term) || (entry.category ?? "").includes(term)) s = 20;
      else if (description.includes(term)) s = 10;
      if (s === 0) {
        score = 0;
        break;
      }
      score += s;
    }
    if (score > 0) scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .map((s) => s.entry);
}

export function initPalette(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>("[data-palette-input]");
  const list = root.querySelector<HTMLElement>("[data-palette-rows]");
  const status = root.querySelector<HTMLElement>("[data-palette-status]");
  const empty = root.querySelector<HTMLElement>("[data-palette-empty]");
  const emptyQuery = root.querySelector<HTMLElement>("[data-palette-query]");
  const filters = [...root.querySelectorAll<HTMLButtonElement>("[data-filter]")];
  if (!input || !list) return;

  const rows = new Map(
    [...list.querySelectorAll<HTMLElement>(".row")].map((row) => [row.dataset.name ?? "", row]),
  );
  const originalOrder = [...rows.keys()];
  let index: IndexEntry[] | undefined;
  let filter: Filter = "all";

  // Fetched once; until it arrives, fall back to data already in the DOM.
  const load = fetch("/r/registry.json")
    .then((r) => (r.ok ? (r.json() as Promise<{ entries: IndexEntry[] }>) : Promise.reject(r)))
    .then((data) => {
      index = data.entries;
    })
    .catch(() => {
      index = [...rows.values()].map((row) => ({
        name: row.dataset.name ?? "",
        type: row.dataset.type === "skill" ? "skill" : "agent",
        description: row.querySelector(".row-desc")?.textContent ?? "",
        tags: [],
      }));
    });

  const visibleSummaries = () => [
    ...list.querySelectorAll<HTMLElement>(".row:not([hidden]) > details > summary"),
  ];

  function render(): void {
    if (!input || !list) return;
    const query = input.value.trim();
    const matches = query && index ? rank(index, query).map((e) => e.name) : originalOrder;
    const shown = matches.flatMap((name) => {
      const row = rows.get(name);
      return row && (filter === "all" || row.dataset.type === filter) ? [row] : [];
    });
    const shownSet = new Set(shown);
    // Matches first, in rank order; hidden rows keep their original order after them.
    for (const row of shown) list.append(row);
    for (const row of rows.values()) {
      row.hidden = !shownSet.has(row);
      if (row.hidden) list.append(row);
    }

    if (status) {
      status.textContent = query
        ? `${shown.length} result${shown.length === 1 ? "" : "s"}`
        : `${shown.length} entries`;
    }
    if (empty) empty.hidden = shown.length > 0;
    if (emptyQuery) emptyQuery.textContent = query ? `“${query}”` : "this filter";
    syncUrl(query);
  }

  function syncUrl(query: string): void {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    if (filter !== "all") url.searchParams.set("type", filter);
    else url.searchParams.delete("type");
    history.replaceState(null, "", url);
  }

  function setFilter(next: Filter): void {
    filter = next;
    for (const button of filters)
      button.setAttribute("aria-pressed", String(button.dataset.filter === next));
    render();
  }

  input.addEventListener("input", () => {
    if (index) render();
    else void load.then(render);
  });
  for (const button of filters) {
    button.addEventListener("click", () => setFilter((button.dataset.filter as Filter) ?? "all"));
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      visibleSummaries()[0]?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const first = visibleSummaries()[0];
      if (first) {
        first.parentElement?.setAttribute("open", "");
        first.focus();
      }
    } else if (event.key === "Escape") {
      if (input.value) {
        input.value = "";
        render();
      } else {
        input.blur();
      }
    }
  });

  list.addEventListener("keydown", (event) => {
    const summary = (event.target as Element).closest("summary");
    if (!summary) return;
    const all = visibleSummaries();
    const i = all.indexOf(summary as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? all[i + 1] : all[i - 1];
      if (next) next.focus();
      else if (event.key === "ArrowUp") input.focus();
    } else if (event.key === "Escape") {
      summary.parentElement?.removeAttribute("open");
      input.focus();
    }
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    const typing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
    const isSlash = event.key === "/" && !typing;
    const isCmdK = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
    if (isSlash || isCmdK) {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });

  // Restore state from ?q= and ?type= so searches can be shared.
  const params = new URLSearchParams(window.location.search);
  const q = params.get("q");
  const type = params.get("type");
  if (q) input.value = q;
  if (type === "agent" || type === "skill") setFilter(type);
  // Ranking needs the index, so re-render once it has loaded.
  if (q) void load.then(render);
}
