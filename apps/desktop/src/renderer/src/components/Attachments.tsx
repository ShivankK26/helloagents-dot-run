import { useState, type ClipboardEvent, type DragEvent } from "react";
import { errorText } from "../toast";
import { Icon } from "./Icons";

const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;

export interface Attachment {
  id: string;
  name: string;
  /** Data URL for the thumbnail. */
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
export function useAttachments(onError: (message: string) => void) {
  const api = window.helloagents;
  const [items, setItems] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);

  async function add(files: Iterable<File>) {
    const images = [...files].filter((f) => TYPES.includes(f.type));
    if (!images.length) return onError("Only PNG, JPEG, GIF and WebP images can be attached.");
    const fits = images.filter((f) => f.size <= MAX_BYTES).slice(0, MAX_FILES - items.length);
    if (fits.length < images.length) onError(`Up to ${MAX_FILES} images, each under 10 MB.`);
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
        preview: await readAsDataUrl(file),
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
        if (!files.some((f) => TYPES.includes(f.type))) return;
        e.preventDefault();
        void add(files);
      },
    },
  };
}

/** Thumbnails of attached images, each with a remove button. */
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
        <figure key={a.id} className={`thumb ${a.path ? "" : "saving"}`} title={a.name}>
          <img src={a.preview} alt={a.name} />
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

/** The paperclip button: opens the file picker for images. */
export function AttachButton({ onFiles }: { onFiles: (files: FileList) => void }) {
  return (
    <label className="chip attach" title="Attach images (or drop / paste them)">
      <Icon name="image" size={14} />
      <input
        type="file"
        accept={TYPES.join(",")}
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

/** Shown over the box while images are dragged onto it. */
export function DropOverlay() {
  return (
    <div className="drop-overlay" aria-hidden="true">
      <Icon name="image" size={18} /> Drop images to attach
    </div>
  );
}
