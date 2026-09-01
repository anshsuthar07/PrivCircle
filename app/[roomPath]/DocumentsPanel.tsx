"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { Button, StatusMessage } from "@/app/components/ui/controls";
import { expiryLabel, formatBytes, uploadedLabel } from "@/lib/ui-labels";
import styles from "./documents.module.css";

export interface RoomDocument {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
  expiresAt: string;
}

interface DocumentLimits {
  maxFileBytes: number;
  maxDocuments: number;
  maxTotalBytes: number;
}

interface Upload {
  key: string;
  name: string;
  size: number;
  loaded: number;
  percentage: number;
  bytesPerSecond: number;
  state: "preparing" | "uploading" | "finalizing" | "failed";
  message?: string;
  controller: AbortController;
  documentId?: string;
}

const DEFAULT_LIMITS: DocumentLimits = {
  maxFileBytes: 300 * 1024 * 1024,
  maxDocuments: 20,
  maxTotalBytes: 1024 * 1024 * 1024,
};

const LIST_POLL_MS = 45_000;
const CLOCK_TICK_MS = 60_000;

/** Above this size, parallel parts and per-part retries are worth their overhead. */
const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;

async function readPayload(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function messageFor(payload: Record<string, unknown>, fallback: string) {
  return typeof payload.message === "string" ? payload.message : fallback;
}

function formatSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** A deliberately generic glyph: uploads are never parsed, previewed, or rendered. */
function FileGlyph({ filename }: { filename: string }) {
  const extension = filename.includes(".")
    ? (filename.split(".").pop() || "").slice(0, 4).toUpperCase()
    : "FILE";
  return (
    <span className={styles.glyph} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M6 2.75h7.5L18.5 7.5v13.75H6z" />
        <path d="M13.25 3v5h5" />
      </svg>
      <span className={styles.glyphExtension}>{extension}</span>
    </span>
  );
}

export function DocumentsPanel({
  path,
  open,
  onClose,
  revision,
  onChanged,
  onCountChange,
}: {
  path: string;
  open: boolean;
  onClose: () => void;
  revision: number;
  onChanged: () => void;
  onCountChange: (count: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [documents, setDocuments] = useState<RoomDocument[]>([]);
  const [limits, setLimits] = useState<DocumentLimits>(DEFAULT_LIMITS);
  const [enabled, setEnabled] = useState(true);
  const [participantId, setParticipantId] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [, setClock] = useState(0);
  const headingId = useId();

  const patchUpload = useCallback((key: string, patch: Partial<Upload>) => {
    setUploads((current) =>
      current.map((upload) => (upload.key === key ? { ...upload, ...patch } : upload)),
    );
  }, []);

  const removeUpload = useCallback((key: string) => {
    setUploads((current) => current.filter((upload) => upload.key !== key));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/rooms/${encodeURIComponent(path)}/documents`,
        { cache: "no-store" },
      );
      const payload = await readPayload(response);
      if (!response.ok) {
        setError(
          response.status === 429
            ? "Too many requests. Files will refresh shortly."
            : "Files are unavailable right now.",
        );
        return;
      }
      setError("");
      setEnabled(payload.enabled !== false);
      setDocuments(
        Array.isArray(payload.documents) ? (payload.documents as RoomDocument[]) : [],
      );
      if (payload.limits) setLimits(payload.limits as DocumentLimits);
      if (typeof payload.participantId === "string") {
        setParticipantId(payload.participantId);
      }
    } catch {
      setError("Files are unavailable right now.");
    } finally {
      setLoaded(true);
    }
  }, [path]);

  // Deferred the same way the room gate defers its own first load, so the
  // fetch is not treated as a synchronous state update inside the effect.
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh, revision]);

  useEffect(() => {
    onCountChange(documents.length);
  }, [documents.length, onCountChange]);

  // Poll only while the panel is visible. Changes made by the other participant
  // arrive over the shared room document, so a closed panel stays quiet.
  useEffect(() => {
    if (!open) return;
    const listTimer = window.setInterval(() => void refresh(), LIST_POLL_MS);
    const clockTimer = window.setInterval(
      () => setClock((value) => value + 1),
      CLOCK_TICK_MS,
    );
    return () => {
      window.clearInterval(listTimer);
      window.clearInterval(clockTimer);
    };
  }, [open, refresh]);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  const startUpload = useCallback(
    async (file: File) => {
      const key = `${file.name}:${file.size}:${Date.now()}:${Math.random()}`;
      const controller = new AbortController();
      const base: Upload = {
        key,
        name: file.name,
        size: file.size,
        loaded: 0,
        percentage: 0,
        bytesPerSecond: 0,
        state: "preparing",
        controller,
      };

      if (file.size > limits.maxFileBytes) {
        setUploads((current) => [
          ...current,
          {
            ...base,
            state: "failed",
            message: `Files must be ${formatBytes(limits.maxFileBytes)} or smaller.`,
          },
        ]);
        return;
      }

      setUploads((current) => [...current, base]);

      let documentId: string | undefined;
      try {
        const initiate = await fetch(
          `/api/rooms/${encodeURIComponent(path)}/documents`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              size: file.size,
              contentType: file.type || "application/octet-stream",
            }),
            signal: controller.signal,
          },
        );
        const initiated = await readPayload(initiate);
        if (!initiate.ok) {
          patchUpload(key, {
            state: "failed",
            message: messageFor(initiated, "That file could not be accepted."),
          });
          return;
        }

        documentId = String(initiated.documentId);
        patchUpload(key, { state: "uploading", documentId });

        // Imported lazily so the editor bundle does not carry the upload client.
        const { put } = await import("@vercel/blob/client");
        let lastLoaded = 0;
        let lastAt = Date.now();

        await put(String(initiated.storageKey), file, {
          access: "private",
          token: String(initiated.uploadToken),
          // Multipart costs three extra control-plane round trips, which
          // dominates a small file. Reserve it for uploads large enough to
          // benefit from parallel parts and per-part retries.
          multipart: file.size > MULTIPART_THRESHOLD_BYTES,
          contentType: file.type || "application/octet-stream",
          abortSignal: controller.signal,
          onUploadProgress: ({ loaded: sent }) => {
            // The SDK over-reports during multipart uploads (it can pass 100%),
            // so derive the percentage from the file's real size rather than
            // trusting the reported one.
            const transferred = Math.min(Math.max(sent, 0), file.size);
            const now = Date.now();
            const elapsed = now - lastAt;
            const patch: Partial<Upload> = {
              loaded: transferred,
              percentage: file.size > 0 ? (transferred / file.size) * 100 : 0,
            };
            if (elapsed >= 500) {
              patch.bytesPerSecond = ((transferred - lastLoaded) * 1000) / elapsed;
              lastLoaded = transferred;
              lastAt = now;
            }
            patchUpload(key, patch);
          },
        });

        patchUpload(key, { state: "finalizing", percentage: 100 });

        const complete = await fetch(
          `/api/rooms/${encodeURIComponent(path)}/documents/${documentId}/complete`,
          { method: "POST" },
        );
        if (!complete.ok) {
          patchUpload(key, {
            state: "failed",
            message: messageFor(
              await readPayload(complete),
              "The upload could not be finished.",
            ),
          });
          return;
        }

        removeUpload(key);
        setNotice(`${file.name} shared with this room.`);
        await refresh();
        onChanged();
      } catch (cause) {
        const aborted = cause instanceof DOMException && cause.name === "AbortError";
        if (documentId) {
          // Release the reservation now rather than waiting for a cleanup pass.
          void fetch(
            `/api/rooms/${encodeURIComponent(path)}/documents/${documentId}`,
            { method: "DELETE" },
          ).catch(() => undefined);
        }
        if (aborted) {
          removeUpload(key);
          return;
        }
        patchUpload(key, {
          state: "failed",
          message: "The upload failed. Check your connection and try again.",
        });
      }
    },
    [limits.maxFileBytes, onChanged, patchUpload, path, refresh, removeUpload],
  );

  const addFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      setNotice("");
      for (const file of Array.from(files)) void startUpload(file);
    },
    [startUpload],
  );

  async function removeDocument(document: RoomDocument) {
    setNotice("");
    try {
      const response = await fetch(
        `/api/rooms/${encodeURIComponent(path)}/documents/${document.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError(
          messageFor(await readPayload(response), "That file could not be removed."),
        );
        return;
      }
      setError("");
      setNotice(`${document.filename} removed.`);
      await refresh();
      onChanged();
    } catch {
      setError("That file could not be removed.");
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  const usedBytes = documents.reduce(
    (total, document) => total + document.sizeBytes,
    0,
  );
  const atDocumentLimit = documents.length >= limits.maxDocuments;

  return (
    <aside
      id="room-files"
      className={styles.panel}
      aria-labelledby={headingId}
      data-open={open}
      inert={open ? undefined : true}
    >
      <header className={styles.header}>
        <div className={styles.headerTitle}>
          <h2
            className={styles.heading}
            id={headingId}
            tabIndex={-1}
            ref={headingRef}
          >
            Files
          </h2>
          <span className={styles.chip}>Temporary · 24h</span>
        </div>
        <Button
          className={styles.close}
          type="button"
          variant="ghost"
          size="compact"
          onClick={onClose}
          aria-label="Close files"
        >
          Close
        </Button>
      </header>

      {enabled ? (
        <div
          className={styles.body}
          data-dragging={dragging}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node)) return;
            setDragging(false);
          }}
          onDrop={onDrop}
        >
          <div className={styles.dropzone}>
            <span className={styles.dropIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 16V4" />
                <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
                <path d="M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15" />
              </svg>
            </span>
            <p className={styles.dropTitle}>Drop files to share</p>
            <p className={styles.dropHint}>
              Up to {formatBytes(limits.maxFileBytes)} each · deleted after 24 hours
            </p>
            <Button
              type="button"
              variant="secondary"
              size="compact"
              onClick={() => inputRef.current?.click()}
              disabled={atDocumentLimit}
            >
              Upload files
            </Button>
            {/* Hidden rather than visually-hidden: the labelled button above
                is the real control, so this must not surface as a second,
                unlabelled control in the accessibility tree. */}
            <input
              hidden
              ref={inputRef}
              type="file"
              multiple
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          {atDocumentLimit ? (
            <StatusMessage tone="warning">
              This room is holding its maximum of {limits.maxDocuments} files.
            </StatusMessage>
          ) : null}
          {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}

          {uploads.length > 0 ? (
            <ul className={styles.list} aria-label="Uploads in progress">
              {uploads.map((upload) => (
                <li className={styles.upload} key={upload.key}>
                  <div className={styles.uploadRow}>
                    <span className={styles.uploadName} title={upload.name}>
                      {upload.name}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="compact"
                      onClick={() => {
                        upload.controller.abort();
                        if (upload.state === "failed") removeUpload(upload.key);
                      }}
                      aria-label={
                        upload.state === "failed"
                          ? `Dismiss ${upload.name}`
                          : `Cancel upload of ${upload.name}`
                      }
                    >
                      {upload.state === "failed" ? "Dismiss" : "Cancel"}
                    </Button>
                  </div>
                  {upload.state === "failed" ? (
                    <p className={styles.uploadError}>{upload.message}</p>
                  ) : (
                    <>
                      <div
                        className={styles.progressTrack}
                        role="progressbar"
                        aria-valuenow={Math.round(upload.percentage)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Uploading ${upload.name}`}
                      >
                        <span
                          className={styles.progressFill}
                          style={{ width: `${Math.max(2, upload.percentage)}%` }}
                        />
                      </div>
                      <p className={styles.uploadMeta}>
                        {upload.state === "preparing"
                          ? "Preparing…"
                          : upload.state === "finalizing"
                            ? "Finishing…"
                            : `${Math.round(upload.percentage)}% of ${formatBytes(upload.size)}`}
                        {upload.state === "uploading" && upload.bytesPerSecond > 0
                          ? ` · ${formatSpeed(upload.bytesPerSecond)}`
                          : ""}
                      </p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {documents.length > 0 ? (
            <ul className={styles.list} aria-label="Shared files">
              {documents.map((document) => (
                <li className={styles.document} key={document.id}>
                  <FileGlyph filename={document.filename} />
                  <div className={styles.documentBody}>
                    <p className={styles.documentName} title={document.filename}>
                      {document.filename}
                    </p>
                    <p className={styles.documentMeta}>
                      {formatBytes(document.sizeBytes)} ·{" "}
                      {uploadedLabel(document.createdAt)}
                      {document.uploadedBy === participantId ? " · you" : ""}
                    </p>
                    <p className={styles.documentExpiry}>
                      {expiryLabel(document.expiresAt)}
                    </p>
                  </div>
                  <div className={styles.documentActions}>
                    <a
                      className={styles.download}
                      href={`/api/rooms/${encodeURIComponent(path)}/documents/${document.id}/download`}
                      download={document.filename}
                    >
                      Download
                    </a>
                    {document.uploadedBy === participantId ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="compact"
                        onClick={() => void removeDocument(document)}
                        aria-label={`Remove ${document.filename}`}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : loaded && uploads.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>Temporary documents</p>
              <p className={styles.emptyBody}>
                Share files with everyone in this room. Files automatically
                disappear after 24 hours.
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={styles.body}>
          <StatusMessage tone="info">
            File sharing is not configured for this deployment.
          </StatusMessage>
        </div>
      )}

      <footer className={styles.footer}>
        <span>
          {documents.length} {documents.length === 1 ? "file" : "files"} ·{" "}
          {formatBytes(usedBytes)} of {formatBytes(limits.maxTotalBytes)}
        </span>
      </footer>
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
    </aside>
  );
}
