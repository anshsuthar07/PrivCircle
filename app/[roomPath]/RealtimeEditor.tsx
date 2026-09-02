"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { tags } from "@lezer/highlight";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import { ROOM_CAPACITY, type SafeRoomMetadata } from "@/lib/types";
import {
  connectionLabel,
  deriveConnectionState,
  expirationLabel,
  persistenceNotice,
  type PersistenceState,
} from "@/lib/ui-labels";
import { decodePersistence, HEARTBEAT } from "@/lib/realtime/messages";
import { Button, Select } from "@/app/components/ui/controls";
import { DocumentsPanel } from "./DocumentsPanel";
import styles from "./editor.module.css";

type LanguageId =
  | "plaintext"
  | "javascript"
  | "typescript"
  | "json"
  | "html"
  | "css"
  | "python"
  | "markdown"
  | "sql"
  | "shell";

const languages: Array<{ id: LanguageId; label: string }> = [
  { id: "plaintext", label: "Plain text" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "json", label: "JSON" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "python", label: "Python" },
  { id: "markdown", label: "Markdown" },
  { id: "sql", label: "SQL" },
  { id: "shell", label: "Shell" },
];

const privCircleHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--color-syntax-keyword)" },
  { tag: [tags.name, tags.deleted, tags.character, tags.propertyName], color: "var(--color-text-primary)" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "var(--color-syntax-function)" },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: "var(--color-syntax-constant)" },
  { tag: [tags.definition(tags.name), tags.separator], color: "var(--color-syntax-definition)" },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier], color: "var(--color-syntax-type)" },
  { tag: [tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link], color: "var(--color-syntax-operator)" },
  { tag: [tags.meta, tags.comment], color: "var(--color-text-subtle)", fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: "var(--color-syntax-atom)" },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: "var(--color-syntax-string)" },
  { tag: tags.invalid, color: "var(--color-error)", textDecoration: "underline" },
]);

function isLanguage(value: unknown): value is LanguageId {
  return languages.some((language) => language.id === value);
}

function languageExtension(language: LanguageId) {
  switch (language) {
    case "javascript": return javascript();
    case "typescript": return javascript({ typescript: true });
    case "json": return json();
    case "html": return html();
    case "css": return css();
    case "python": return python();
    case "markdown": return markdown();
    case "sql": return sql();
    case "shell": return StreamLanguage.define(shell);
    default: return [];
  }
}

function websocketUrl(path: string) {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured.replace(/\/$/, "");
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/ws/${encodeURIComponent(path)}`;
}

const KEYBOARD_HINT_ID = "editor-keyboard-hint";

/**
 * Hocuspocus reports a denial as free text, so the seat limit is matched
 * case-insensitively and treated as the exception rather than the default: an
 * unrecognized reason is an access problem, which offers the user a real
 * recovery path instead of telling them the room is full.
 */
function isRoomFull(reason: string) {
  return /room_full/i.test(reason);
}

/** Below this width the files panel is drawn over the editor rather than beside it. */
const FILES_OVERLAY_QUERY = "(max-width: 900px)";

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

export default function RealtimeEditor({
  path,
  metadata,
  participantId,
  getAccessToken,
  onAccessExpired,
}: {
  path: string;
  metadata: SafeRoomMetadata;
  participantId: string;
  getAccessToken: () => Promise<string>;
  onAccessExpired: () => void;
}) {
  const editorHost = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const settingsRef = useRef<Y.Map<unknown> | null>(null);
  const undoRef = useRef<Y.UndoManager | null>(null);
  const wrapCompartmentRef = useRef<Compartment | null>(null);
  const overflowRef = useRef<HTMLDetailsElement>(null);
  const fallbackRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<Y.Map<unknown> | null>(null);
  const [language, setLanguage] = useState<LanguageId>("javascript");
  const [wrap, setWrap] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("privcircle:word-wrap") === "true",
  );
  const [participants, setParticipants] = useState(0);
  // Independent signals. The status label is derived from all of them in one
  // place rather than written by whichever provider callback fires last.
  const [providerConnected, setProviderConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [synced, setSynced] = useState(false);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [online, setOnline] = useState(true);
  const [persistence, setPersistence] = useState<PersistenceState>("ok");
  const [editorFocused, setEditorFocused] = useState(false);
  const [blocked, setBlocked] = useState<"full" | "access" | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [copyFallback, setCopyFallback] = useState(false);
  const [inviteVisible, setInviteVisible] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [roomUrl, setRoomUrl] = useState("");
  const [filesOpen, setFilesOpen] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [filesRevision, setFilesRevision] = useState(0);
  const filesOverlay = useMediaQuery(FILES_OVERLAY_QUERY);

  useEffect(() => {
    const currentUrl = window.location.href;
    const marker = `privcircle:created:${path}`;
    queueMicrotask(() => {
      setRoomUrl(currentUrl);
      if (sessionStorage.getItem(marker)) {
        sessionStorage.removeItem(marker);
        setInviteVisible(true);
      }
    });
  }, [path]);

  // The live region is an announcement, not a permanent label: leaving the last
  // message in it meant a screen reader re-read "Room link copied." for the rest
  // of the session.
  useEffect(() => {
    if (!copyStatus) return;
    const timer = window.setTimeout(() => setCopyStatus(""), 6_000);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  useEffect(() => {
    const storedWrap = localStorage.getItem("privcircle:word-wrap") === "true";
    if (!editorHost.current) return;

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("content");
    const settings = ydoc.getMap<unknown>("settings");
    // A shared counter, not the file list itself: metadata stays server-side and
    // is re-fetched under authorization whenever a participant changes it.
    const files = ydoc.getMap<unknown>("files");
    const undoManager = new Y.UndoManager(ytext);
    const languageCompartment = new Compartment();
    const wrapCompartment = new Compartment();
    settingsRef.current = settings;
    filesRef.current = files;
    undoRef.current = undoManager;
    wrapCompartmentRef.current = wrapCompartment;

    setOnline(navigator.onLine);
    let currentlyConnected = false;
    let view: EditorView | null = null;
    let updateParticipants = () => undefined;
    const provider = new HocuspocusProvider({
      name: path,
      document: ydoc,
      url: websocketUrl(path),
      token: getAccessToken,
      flushDelay: 25,
      onAuthenticationFailed({ reason }) {
        setBlocked(isRoomFull(reason) ? "full" : "access");
      },
      onStatus({ status }) {
        currentlyConnected = status === "connected";
        setProviderConnected(currentlyConnected);
        if (currentlyConnected) {
          setEverConnected(true);
          queueMicrotask(updateParticipants);
        } else {
          setParticipants(0);
          setSynced(false);
        }
      },
      onSynced({ state }) {
        if (!state) return;
        const sharedLanguage = settings.get("language");
        if (!isLanguage(sharedLanguage)) settings.set("language", "javascript");
        setSynced(true);
        queueMicrotask(updateParticipants);
      },
      onUnsyncedChanges({ number }) {
        setUnsyncedCount(number);
      },
      // The server's only way to say it could not store what everyone just
      // agreed on. Without it the room reads as "Synced" and silently reverts.
      onStateless({ payload }) {
        const message = decodePersistence(payload);
        if (message) setPersistence(message.code);
      },
    });

    provider.setAwarenessField("user", {
      id: participantId,
      name: `Guest ${participantId.slice(0, 4).toUpperCase()}`,
      color: "var(--color-primary)",
      colorLight: "var(--color-primary-soft-strong)",
    });

    updateParticipants = () => {
      if (!currentlyConnected || !provider.isAuthenticated) {
        setParticipants(0);
        return;
      }
      const ids = new Set<string>();
      for (const state of provider.awareness?.getStates().values() || []) {
        const user = state.user as { id?: string } | undefined;
        if (user?.id) ids.add(user.id);
      }
      setParticipants(ids.size);
      if (ids.size > 1) setInviteVisible(false);
    };

    const updateLanguage = () => {
      const shared = settings.get("language");
      if (!isLanguage(shared)) return;
      setLanguage(shared);
      view?.dispatch({ effects: languageCompartment.reconfigure(languageExtension(shared)) });
    };

    const updateUndoState = () => {
      setCanUndo(undoManager.undoStack.length > 0);
      setCanRedo(undoManager.redoStack.length > 0);
    };

    const notifyFilesChanged = () => setFilesRevision((value) => value + 1);

    const handleOffline = () => setOnline(false);
    const handleOnline = () => setOnline(true);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    provider.awareness?.on("change", updateParticipants);
    settings.observe(updateLanguage);
    files.observe(notifyFilesChanged);
    undoManager.on("stack-item-added", updateUndoState);
    undoManager.on("stack-item-popped", updateUndoState);
    undoManager.on("stack-cleared", updateUndoState);

    view = new EditorView({
      parent: editorHost.current,
      state: EditorState.create({
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          syntaxHighlighting(privCircleHighlightStyle),
          EditorState.allowMultipleSelections.of(true),
          keymap.of([...yUndoManagerKeymap, indentWithTab, ...defaultKeymap]),
          languageCompartment.of(languageExtension("javascript")),
          wrapCompartment.of(storedWrap ? EditorView.lineWrapping : []),
          yCollab(ytext, provider.awareness, { undoManager }),
          EditorView.contentAttributes.of({
            "aria-label": "Shared code editor",
            "aria-multiline": "true",
            // Tab indents inside a code editor, so it cannot also move focus.
            // The escape route exists, but it is useless if nobody is told
            // about it — which is exactly what WCAG 2.1.2 requires here.
            "aria-describedby": KEYBOARD_HINT_ID,
            "aria-keyshortcuts": "Escape",
            spellcheck: "false",
          }),
          EditorView.domEventHandlers({
            focus: () => {
              setEditorFocused(true);
              return false;
            },
            blur: () => {
              setEditorFocused(false);
              return false;
            },
          }),
          EditorView.theme({
            "&": { height: "100%", color: "var(--color-text-primary)", backgroundColor: "var(--color-bg)" },
            ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-geist-mono), monospace" },
            ".cm-content": { padding: "20px 0", caretColor: "var(--color-primary)" },
            ".cm-line": { padding: "0 16px" },
            ".cm-gutters": { color: "var(--color-text-subtle)", backgroundColor: "var(--color-bg)", borderRight: "1px solid var(--color-border-subtle)" },
            ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--color-primary-soft)" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--color-primary-soft-strong)" },
            ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-primary)" },
          }),
        ],
      }),
    });
    editorViewRef.current = view;

    const heartbeat = window.setInterval(() => {
      if (provider.isAuthenticated) provider.sendStateless(HEARTBEAT);
    }, 25_000);

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      settings.unobserve(updateLanguage);
      files.unobserve(notifyFilesChanged);
      provider.awareness?.off("change", updateParticipants);
      undoManager.off("stack-item-added", updateUndoState);
      undoManager.off("stack-item-popped", updateUndoState);
      undoManager.off("stack-cleared", updateUndoState);
      provider.destroy();
      view?.destroy();
      undoManager.destroy();
      ydoc.destroy();
      settingsRef.current = null;
      filesRef.current = null;
      undoRef.current = null;
      wrapCompartmentRef.current = null;
      editorViewRef.current = null;
    };
  }, [getAccessToken, participantId, path]);

  function selectLanguage(nextLanguage: LanguageId) {
    settingsRef.current?.set("language", nextLanguage);
  }

  const announceFilesChanged = useCallback(() => {
    filesRef.current?.set("revision", Date.now());
  }, []);

  function toggleWrap() {
    const next = !wrap;
    setWrap(next);
    localStorage.setItem("privcircle:word-wrap", String(next));
    const compartment = wrapCompartmentRef.current;
    if (compartment) {
      editorViewRef.current?.dispatch({
        effects: compartment.reconfigure(next ? EditorView.lineWrapping : []),
      });
    }
  }

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyStatus("Room link copied.");
      setCopyFallback(false);
      setInviteVisible(false);
    } catch {
      setCopyStatus("Copy failed. Select and copy the room link below.");
      setCopyFallback(true);
      window.setTimeout(() => {
        fallbackRef.current?.focus();
        fallbackRef.current?.select();
      });
    }
  }, []);

  function runOverflowAction(action: () => void) {
    action();
    const details = overflowRef.current;
    if (!details) return;
    details.open = false;
    details.querySelector<HTMLElement>("summary")?.focus();
  }

  const connection = deriveConnectionState({
    online,
    connected: providerConnected,
    everConnected,
    synced,
    unsyncedCount,
    persistence,
  });
  const persistenceMessage = persistenceNotice(persistence);
  // Stated as a fraction rather than a bare count, so the group can see how
  // much room is left before someone is turned away rather than discovering
  // the ceiling by hitting it.
  const presenceText = participants > 0
    ? `${participants} of ${ROOM_CAPACITY} connected`
    : providerConnected
      ? "Confirming presence…"
      : "Not connected";

  return (
    <main className={styles.shell} id="main">
      <header className={styles.header} inert={blocked ? true : undefined}>
        <div className={styles.brand}>
          <Link className={styles.brandLink} href="/" aria-label="PrivCircle home">PRIVCIRCLE</Link>
          <h1 className={styles.roomName} title={`/${path}`}>/{path}</h1>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.presence} data-connected={participants > 0} aria-live="polite">
            <span className={styles.presenceDot} aria-hidden="true" />
            {presenceText}
          </span>
          {/* Retention lived only in the desktop toolbar, so on a phone the
              room never said how long it survives. */}
          <span className={styles.retention}>{expirationLabel(metadata)}</span>
          <div className={styles.actionGroup}>
            <Button
              className={styles.filesButton}
              type="button"
              variant="tool"
              onClick={() => setFilesOpen((open) => !open)}
              aria-expanded={filesOpen}
              aria-controls="room-files"
            >
              Files
              {fileCount > 0 ? (
                <span className={styles.filesBadge}>{fileCount}</span>
              ) : null}
            </Button>
            <Button className={styles.copyButton} type="button" variant="tool" onClick={copyLink}>
              Copy link
            </Button>
          </div>
        </div>
      </header>

      {inviteVisible ? (
        <aside className={styles.invite} aria-label="Room invitation">
          <div className={styles.inviteCopy}>
            <p className={styles.inviteTitle}>Room created — invite someone</p>
            <input className={styles.inviteInput} value={roomUrl} readOnly aria-label="Room invitation link" />
          </div>
          <Button type="button" variant="secondary" onClick={copyLink}>Copy</Button>
          <Button className={styles.inviteDismiss} type="button" variant="ghost" onClick={() => setInviteVisible(false)}>
            Dismiss
          </Button>
        </aside>
      ) : null}

      {persistenceMessage ? (
        <div className={styles.persistence} role="alert">
          <span className={styles.persistenceIcon} aria-hidden="true">!</span>
          <p>{persistenceMessage}</p>
        </div>
      ) : null}

      <div className={styles.area} data-files-open={filesOpen} inert={blocked ? true : undefined}>
        {/* When the files panel covers the editor there is nothing to see
            behind it, but the editor stayed focusable and typeable — Tab moved
            the caret into a document the reader could not look at. */}
        <div
          ref={editorHost}
          className={styles.host}
          inert={filesOpen && filesOverlay ? true : undefined}
        />
        <DocumentsPanel
          path={path}
          open={filesOpen}
          onClose={() => setFilesOpen(false)}
          revision={filesRevision}
          onChanged={announceFilesChanged}
          onCountChange={setFileCount}
        />
      </div>

      {blocked ? (
        <div className={styles.blocker} role="alertdialog" aria-modal="true" aria-labelledby="room-blocked-title">
          <section className={styles.blockerCard}>
            <h2 id="room-blocked-title">{blocked === "full" ? "Room is full" : "Access expired"}</h2>
            <p>
              {blocked === "full"
                ? `This room holds ${ROOM_CAPACITY} people at a time and every seat is taken. Try again once someone leaves.`
                : "Your access can no longer be verified. Restart the room access flow to continue."}
            </p>
            <div className={styles.blockerActions}>
              <Button type="button" autoFocus onClick={blocked === "access" ? onAccessExpired : () => window.location.reload()}>
                {blocked === "access" ? "Restart access" : "Try again"}
              </Button>
              <Link className={styles.homeLink} href="/">Go home</Link>
            </div>
          </section>
        </div>
      ) : null}

      <footer className={styles.toolbar} inert={blocked ? true : undefined}>
        <div className={styles.toolbarSection}>
          <Select
            className={styles.language}
            aria-label="Shared language"
            value={language}
            options={languages.map((option) => ({
              value: option.id,
              label: option.label,
            }))}
            placement="top"
            onValueChange={(value) => selectLanguage(value as LanguageId)}
          />
        </div>

        <div className={styles.toolbarSection}>
          <div className={styles.desktopTools}>
            <Button variant="tool" size="compact" type="button" disabled={!canUndo} onClick={() => undoRef.current?.undo()}>Undo</Button>
            <Button variant="tool" size="compact" type="button" disabled={!canRedo} onClick={() => undoRef.current?.redo()}>Redo</Button>
            <Button variant="tool" size="compact" type="button" aria-pressed={wrap} onClick={toggleWrap}>Wrap {wrap ? "on" : "off"}</Button>
          </div>
          <details
            className={styles.overflow}
            ref={overflowRef}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              const details = overflowRef.current;
              if (details) details.open = false;
              details?.querySelector<HTMLElement>("summary")?.focus();
            }}
          >
            <summary aria-label="Editor actions">•••</summary>
            <div className={styles.overflowMenu}>
              <Button variant="tool" type="button" disabled={!canUndo} onClick={() => runOverflowAction(() => undoRef.current?.undo())}>Undo</Button>
              <Button variant="tool" type="button" disabled={!canRedo} onClick={() => runOverflowAction(() => undoRef.current?.redo())}>Redo</Button>
              <Button variant="tool" type="button" aria-pressed={wrap} onClick={() => runOverflowAction(toggleWrap)}>Wrap {wrap ? "on" : "off"}</Button>
            </div>
          </details>
          <span className={styles.keyboardHint} data-visible={editorFocused} aria-hidden="true">
            Esc then Tab to leave the editor
          </span>
          <span className={styles.connection} data-state={connection} role="status">
            {connectionLabel(connection)}
            <span className={styles.connectionDot} aria-hidden="true" />
          </span>
        </div>
      </footer>

      <p className="sr-only" id={KEYBOARD_HINT_ID}>
        Tab inserts an indent inside this editor. Press Escape and then Tab to
        move focus to the toolbar.
      </p>
      <p className="sr-only" role="status" aria-live="polite">{copyStatus}</p>
      {copyFallback ? (
        <div className={styles.fallback}>
          <label htmlFor="copy-fallback">Room link</label>
          <input className={styles.fallbackInput} ref={fallbackRef} id="copy-fallback" value={roomUrl} readOnly />
        </div>
      ) : null}
    </main>
  );
}
