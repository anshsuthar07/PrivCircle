"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EditorState, Compartment } from "@codemirror/state";
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
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
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
import { oneDark } from "@codemirror/theme-one-dark";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import type { SafeRoomMetadata } from "@/lib/types";

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

function expirationLabel(metadata: SafeRoomMetadata) {
  if (metadata.expiration === "lifetime") return "Lifetime room";
  const labels = { "1h": "1-hour room", "24h": "24-hour room", "7d": "7-day room" };
  return labels[metadata.expiration];
}

export default function RealtimeEditor({
  path,
  metadata,
  participantId,
  getAccessToken,
}: {
  path: string;
  metadata: SafeRoomMetadata;
  participantId: string;
  getAccessToken: () => Promise<string>;
}) {
  const editorHost = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const settingsRef = useRef<Y.Map<unknown> | null>(null);
  const undoRef = useRef<Y.UndoManager | null>(null);
  const wrapCompartmentRef = useRef<Compartment | null>(null);
  const [language, setLanguage] = useState<LanguageId>("javascript");
  const [wrap, setWrap] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("privcircle:word-wrap") === "true",
  );
  const [participants, setParticipants] = useState(1);
  const [connection, setConnection] = useState("Connecting…");
  const [blocked, setBlocked] = useState<"full" | "access" | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const storedWrap = localStorage.getItem("privcircle:word-wrap") === "true";
    if (!editorHost.current) return;

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("content");
    const settings = ydoc.getMap<unknown>("settings");
    const undoManager = new Y.UndoManager(ytext);
    const languageCompartment = new Compartment();
    const wrapCompartment = new Compartment();
    settingsRef.current = settings;
    undoRef.current = undoManager;
    wrapCompartmentRef.current = wrapCompartment;

    let connectedOnce = false;
    let view: EditorView | null = null;
    const provider = new HocuspocusProvider({
      name: path,
      document: ydoc,
      url: websocketUrl(path),
      token: getAccessToken,
      flushDelay: 25,
      onAuthenticationFailed({ reason }) {
        setBlocked(reason.includes("ROOM_FULL") ? "full" : "access");
      },
      onStatus({ status }) {
        if (status === "connected") {
          connectedOnce = true;
          setConnection("Synchronizing…");
        } else if (status === "disconnected") {
          setConnection(connectedOnce ? "Reconnecting…" : "Connecting…");
        } else {
          setConnection(connectedOnce ? "Reconnecting…" : "Connecting…");
        }
      },
      onSynced({ state }) {
        if (!state) return;
        const sharedLanguage = settings.get("language");
        if (!isLanguage(sharedLanguage)) settings.set("language", "javascript");
        setConnection("Saved");
      },
      onUnsyncedChanges({ number }) {
        setConnection(number > 0 ? "Saving…" : "Saved");
      },
    });

    provider.setAwarenessField("user", {
      id: participantId,
      name: `Guest ${participantId.slice(0, 4).toUpperCase()}`,
      color: "#72e8aa",
      colorLight: "#72e8aa33",
    });

    const updateParticipants = () => {
      const ids = new Set<string>();
      for (const state of provider.awareness?.getStates().values() || []) {
        const user = state.user as { id?: string } | undefined;
        if (user?.id) ids.add(user.id);
      }
      setParticipants(Math.max(1, ids.size));
    };

    const updateLanguage = () => {
      const shared = settings.get("language");
      if (!isLanguage(shared)) return;
      setLanguage(shared);
      view?.dispatch({ effects: languageCompartment.reconfigure(languageExtension(shared)) });
    };

    provider.awareness?.on("change", updateParticipants);
    settings.observe(updateLanguage);

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
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorState.allowMultipleSelections.of(true),
          keymap.of([...yUndoManagerKeymap, indentWithTab, ...defaultKeymap]),
          languageCompartment.of(languageExtension("javascript")),
          wrapCompartment.of(storedWrap ? EditorView.lineWrapping : []),
          oneDark,
          yCollab(ytext, provider.awareness, { undoManager }),
          EditorView.theme({
            "&": { height: "100%", backgroundColor: "#090d0b" },
            ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-geist-mono), monospace" },
            ".cm-content": { padding: "20px 0", caretColor: "#72e8aa" },
            ".cm-gutters": { backgroundColor: "#090d0b", borderRight: "1px solid #1d2521" },
          }),
        ],
      }),
    });
    editorViewRef.current = view;

    const heartbeat = window.setInterval(() => {
      if (provider.isAuthenticated) provider.sendStateless("heartbeat");
    }, 25_000);

    return () => {
      window.clearInterval(heartbeat);
      settings.unobserve(updateLanguage);
      provider.awareness?.off("change", updateParticipants);
      provider.destroy();
      view?.destroy();
      undoManager.destroy();
      ydoc.destroy();
      settingsRef.current = null;
      undoRef.current = null;
      wrapCompartmentRef.current = null;
      editorViewRef.current = null;
    };
  }, [getAccessToken, participantId, path]);

  function selectLanguage(nextLanguage: LanguageId) {
    settingsRef.current?.set("language", nextLanguage);
  }

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

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  return (
    <main className="editor-shell">
      <header className="editor-header">
        <div className="editor-brand">
          <Link href="/" aria-label="PrivCircle home">PRIVCIRCLE</Link>
          <span className="room-name">/{path}</span>
        </div>
        <div className="header-actions">
          <span className="presence" aria-live="polite">
            <span className="presence-dot" />
            {participants} {participants === 1 ? "person" : "people"} connected
          </span>
          <button className="tool-button copy-button" type="button" onClick={copyLink}>
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </header>

      <div className="editor-area">
        <div ref={editorHost} className="editor-host" aria-label="Shared code editor" />
        {blocked ? (
          <div className="editor-blocker" role="alert">
            <div className="eyebrow">PRIVCIRCLE</div>
            <h1>{blocked === "full" ? "Room is full" : "Access expired"}</h1>
            <p>
              {blocked === "full"
                ? "This room already has 2 active participants."
                : "Your room access could not be verified. Re-enter from the private link."}
            </p>
            <button className="primary-button" type="button" onClick={() => window.location.reload()}>
              Try again
            </button>
          </div>
        ) : null}
      </div>

      <footer className="editor-toolbar">
        <div className="toolbar-section">
          <select
            className="language-select"
            aria-label="Shared language"
            value={language}
            onChange={(event) => selectLanguage(event.target.value as LanguageId)}
          >
            {languages.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          <span className="room-kind">{expirationLabel(metadata)}</span>
        </div>
        <div className="toolbar-section toolbar-right">
          <button className="tool-button" type="button" onClick={() => undoRef.current?.undo()}>Undo</button>
          <button className="tool-button" type="button" onClick={() => undoRef.current?.redo()}>Redo</button>
          <button className={`tool-button ${wrap ? "active" : ""}`} type="button" onClick={toggleWrap}>
            Wrap {wrap ? "on" : "off"}
          </button>
          <span className={`save-state ${connection === "Saved" ? "saved" : ""}`}>
            {connection}<span />
          </span>
        </div>
      </footer>
    </main>
  );
}
