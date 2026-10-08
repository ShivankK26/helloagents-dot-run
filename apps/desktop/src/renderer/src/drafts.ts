/** Unsent text and images, kept per project (new task) or per run (follow-up). */
export interface Draft {
  text: string;
  images: Array<{ name: string; path: string }>;
}

const key = (id: string) => `helloagents.draft.${id}`;

export function loadDraft(id: string): Draft {
  try {
    const saved = JSON.parse(localStorage.getItem(key(id)) ?? "null") as Draft | null;
    if (saved && typeof saved.text === "string" && Array.isArray(saved.images)) return saved;
  } catch {
    // nothing saved
  }
  return { text: "", images: [] };
}

export function saveDraft(id: string, draft: Draft): void {
  try {
    if (!draft.text.trim() && !draft.images.length) localStorage.removeItem(key(id));
    else localStorage.setItem(key(id), JSON.stringify(draft));
  } catch {
    // not remembered
  }
}
