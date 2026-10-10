import { useEffect, useState, type ClipboardEvent, type DragEvent } from "react";
import { errorText } from "../toast";
import { Icon } from "./Icons";

const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_FILES = 10;
const MAX_IMAGE_MB = 10;
const MAX_FILE_MB = 30;
const isImage = (name: string) => /\.(png|jpe?g|gif|webp)$/i.test(name);
const tooBig = (f: File) =>
  f.size > (TYPES.includes(f.type) ? MAX_IMAGE_MB : MAX_FILE_MB) * 1024 * 1024;

export interface Attachment {
  id: string;
  name: string;
  /** Data URL for an image's thumbnail; empty for other files. */
  preview: string;
  /** Where it was saved for the agent; missing while saving. */
  path?: string;
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the image."));
    reader.readAsDataURL(file);
  });

/** Images attached to a message: drop, paste or pick them; each is saved for the agent at once. */
export function useAttachments(
  onError: (message: string) => void,
  initial: Array<{ name: string; path: string }> = [],
) {
  const api = window.helloagents;
  const [items, setItems] = useState<Attachment[]>(() =>
    initial.map((a) => ({ ...a, id: crypto.randomUUID(), preview: "" })),
  );
  const [dragging, setDragging] = useState(false);

  // Images from a saved draft: load their thumbnails, and drop any that are gone.
  useEffect(() => {
    for (const a of items) {
      if (a.preview || !a.path || !isImage(a.name)) continue;
      void api
        .readImage(a.path)
        .then((preview) =>
          setItems((list) =>
            preview
              ? list.map((b) => (b.id === a.id ? { ...b, preview } : b))
              : list.filter((b) => b.id !== a.id),
          ),
        );
    }
    // Only once, for the images the draft brought back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add(files: Iterable<File>) {
    // Any file: images get a thumbnail, the rest (Markdown, PDFs, code…) a file card.
    const picked = [...files];
    if (!picked.length) return;
    const fits = picked.filter((f) => !tooBig(f)).slice(0, MAX_FILES - items.length);
    if (fits.length < picked.length)
      onError(
        `Up to ${MAX_FILES} files; images under ${MAX_IMAGE_MB} MB, other files under ${MAX_FILE_MB} MB.`,
      );
    // Show them all at once, so sending waits until every one is saved.
    const added = await Promise.all(
      fits.map(async (file, i) => ({
        file,
        id: crypto.randomUUID(),
        // Pasted screenshots are all called "image.png"; number them instead.
        name:
          file.name && file.name !== "image.png"
            ? file.name
            : `screenshot-${items.length + i + 1}.png`,
        preview: TYPES.includes(file.type) ? await readAsDataUrl(file) : "",
      })),
    ).catch((e: unknown) => {
      onError(errorText(e));
      return [];
    });
    setItems((list) => [...list, ...added.map(({ id, name, preview }) => ({ id, name, preview }))]);
    await Promise.all(
      added.map(async ({ file, id, name }) => {
        try {
          const path = await api.saveAttachment(name, new Uint8Array(await file.arrayBuffer()));
          setItems((list) => list.map((a) => (a.id === id ? { ...a, path } : a)));
        } catch (e) {
          setItems((list) => list.filter((a) => a.id !== id));
          onError(errorText(e));
        }
      }),
    );
  }

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");

  return {
    items,
    dragging,
    saving: items.some((a) => !a.path),
    paths: () => items.flatMap((a) => (a.path ? [a.path] : [])),
    /** The saved files, for keeping in a draft. */
    saved: () => items.flatMap((a) => (a.path ? [{ name: a.name, path: a.path }] : [])),
    add: (files: Iterable<File>) => void add(files),
    remove: (id: string) => setItems((list) => list.filter((a) => a.id !== id)),
    clear: () => setItems([]),
    /** Spread onto the box that accepts drops and pastes. */
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      },
      onDrop: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        void add(e.dataTransfer.files);
      },
      onPaste: (e: ClipboardEvent) => {
        const files = [...e.clipboardData.files];
        if (!files.length) return;
        e.preventDefault();
        void add(files);
      },
    },
  };
}

/** Attached files: thumbnails for images, a card with the name for the rest. */
export function AttachmentStrip({
  items,
  onRemove,
}: {
  items: Attachment[];
  onRemove: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="attachments">
      {items.map((a) => (
        <figure
          key={a.id}
          className={`thumb ${a.path ? "" : "saving"} ${isImage(a.name) ? "" : "file"}`}
          title={a.name}
        >
          {isImage(a.name) ? (
            a.preview ? (
              <img src={a.preview} alt={a.name} />
            ) : null
          ) : (
            <>
              <Icon name="file" size={15} />
              <span className="thumb-name">{a.name}</span>
            </>
          )}
          <button
            type="button"
            className="thumb-x"
            aria-label={`Remove ${a.name}`}
            onClick={() => onRemove(a.id)}
          >
            <Icon name="close" size={11} />
          </button>
        </figure>
      ))}
    </div>
  );
}

/** The attach button: opens the file picker for any files. */
export function AttachButton({ onFiles }: { onFiles: (files: FileList) => void }) {
  return (
    <label
      className="chip attach"
      title="Attach files: images, PDFs, Markdown… (or drop / paste them)"
    >
      <Icon name="clip" size={14} />
      <input
        type="file"
        multiple
        className="sr"
        onChange={(e) => {
          if (e.target.files) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}

/** Shown over the box while files are dragged onto it. */
export function DropOverlay() {
  return (
    <div className="drop-overlay" aria-hidden="true">
      <Icon name="file" size={18} /> Drop files to attach
    </div>
  );
}
