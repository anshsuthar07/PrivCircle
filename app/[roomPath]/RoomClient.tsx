"use client";

import {
  FormEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import type { SafeRoomMetadata } from "@/lib/types";
import {
  Button,
  FormField,
  PasswordInput,
} from "@/app/components/ui/controls";
import styles from "./room.module.css";

const RealtimeEditor = lazy(() => import("./RealtimeEditor"));

interface AccessPayload {
  accessToken: string;
  tokenExpiresAt: string;
  participantId: string;
}

type Phase =
  | "loading"
  | "locked"
  | "granted"
  | "expired"
  | "unavailable"
  | "error";

export type RoomStateVariant = Extract<
  Phase,
  "loading" | "expired" | "unavailable" | "error"
>;

async function readPayload(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export function RoomClient({ path }: { path: string }) {
  const controllerRef = useRef<AbortController | null>(null);
  // The token is mirrored into a ref so `getAccessToken` can stay referentially
  // stable. It is read inside the callback body, never captured, so a refresh
  // cannot serve a stale token — see the note on `getAccessToken` below.
  const accessRef = useRef<AccessPayload | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [metadata, setMetadata] = useState<SafeRoomMetadata | null>(null);
  const [access, setAccess] = useState<AccessPayload | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const applyAccess = useCallback((next: AccessPayload | null) => {
    accessRef.current = next;
    setAccess(next);
  }, []);

  const requestAccess = useCallback(async (): Promise<AccessPayload> => {
    const response = await fetch(`/api/rooms/${encodeURIComponent(path)}/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    const payload = await readPayload(response);
    if (!response.ok) {
      throw new Error(String(payload.code || "ACCESS_FAILED"));
    }
    const nextAccess = payload as unknown as AccessPayload;
    applyAccess(nextAccess);
    return nextAccess;
  }, [applyAccess, path]);

  const enterRoom = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase("loading");
    setMessage("");

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(path)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await readPayload(response);
      if (response.status === 410) {
        setPhase("expired");
        return;
      }
      if (!response.ok) {
        setPhase(response.status === 404 ? "unavailable" : "error");
        return;
      }

      const nextMetadata = payload as unknown as SafeRoomMetadata;
      setMetadata(nextMetadata);
      try {
        await requestAccess();
        setPhase("granted");
      } catch (error) {
        if (error instanceof Error && error.message === "PASSWORD_REQUIRED") {
          setPhase("locked");
          return;
        }
        setPhase("error");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setPhase("error");
      }
    }
  }, [path, requestAccess]);

  useEffect(() => {
    const timer = window.setTimeout(() => void enterRoom(), 0);
    return () => {
      window.clearTimeout(timer);
      controllerRef.current?.abort();
    };
  }, [enterRoom]);

  /**
   * Supplies the realtime provider with a valid token.
   *
   * This identity must never change while the room is open. The editor rebuilds
   * itself whenever this function changes, and refreshing the token used to do
   * exactly that: the refresh set state, the state changed this callback, and
   * the change tore down the Y.Doc, the socket, and the whole undo history
   * roughly every fifteen minutes. Reading the current token from a ref keeps
   * the identity fixed for the lifetime of the room while still returning the
   * newest token on every call.
   */
  const getAccessToken = useCallback(async () => {
    const current = accessRef.current;
    if (
      current &&
      new Date(current.tokenExpiresAt).getTime() - Date.now() > 30_000
    ) {
      return current.accessToken;
    }
    return (await requestAccess()).accessToken;
  }, [requestAccess]);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!password) {
      setMessage("Enter the room password.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(path)}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        if (response.status === 429) {
          // The server already computed the remaining window, so it is shown
          // rather than replaced with an unquantified "wait a moment".
          setMessage(
            typeof payload.message === "string"
              ? payload.message
              : "Too many attempts. Try again in about 10 minutes.",
          );
        } else if (response.status >= 500) {
          setMessage("The room service is unavailable. Please try again.");
        } else {
          setMessage("Incorrect password. Please try again.");
          setPassword("");
        }
        return;
      }
      applyAccess(payload as unknown as AccessPayload);
      setPassword("");
      setPhase("granted");
    } catch {
      setMessage("The room service is unavailable. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "granted" && metadata && access) {
    return (
      <Suspense fallback={<RoomState variant="loading" />}>
        <RealtimeEditor
          path={path}
          metadata={metadata}
          participantId={access.participantId}
          getAccessToken={getAccessToken}
          onAccessExpired={() => {
            applyAccess(null);
            void enterRoom();
          }}
        />
      </Suspense>
    );
  }

  if (phase === "locked") {
    return (
      <main className={`${styles.shell} room-gate-shell`} id="main">
        <section
          className={`${styles.card} ${styles.gate} room-gate`}
          aria-labelledby="private-room-title"
        >
          <div className={styles.gateLock} aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="5" y="10" width="14" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
          <div className={styles.eyebrow}>PRIVATE ROOM</div>
          <h1 className={styles.heading} id="private-room-title">
            Password required
          </h1>
          <p className={styles.body}>
            Authenticate before PrivCircle connects to or loads the shared document.
          </p>
          <form
            className={`${styles.gateForm} gate-form`}
            onSubmit={authenticate}
            aria-busy={submitting}
            noValidate
          >
            <FormField
              id="join-password"
              label="Room password"
              error={message || undefined}
            >
              <PasswordInput
                id="join-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setMessage("");
                }}
                placeholder="Enter password"
                minLength={8}
                maxLength={128}
                autoComplete="current-password"
                autoFocus
                required
                invalid={Boolean(message)}
                aria-describedby={message ? "join-password-error" : undefined}
                aria-errormessage={message ? "join-password-error" : undefined}
              />
            </FormField>
            <Button
              type="submit"
              size="main"
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? "Checking…" : "Join room"}
            </Button>
          </form>
          <p className={styles.roomPath}>/{path}</p>
        </section>
      </main>
    );
  }

  return (
    <RoomState
      variant={phase === "granted" ? "error" : phase}
      onRetry={phase === "error" ? () => void enterRoom() : undefined}
    />
  );
}

function RoomState({
  variant,
  onRetry,
}: {
  variant: RoomStateVariant;
  onRetry?: () => void;
}) {
  const content = {
    loading: {
      title: "Opening room…",
      body: "Checking room access and availability.",
    },
    expired: {
      title: "Room expired",
      body: "This room reached its inactivity limit and its shared content is no longer available.",
    },
    unavailable: {
      title: "Room unavailable",
      body: "The link may be incorrect, or the room may never have existed.",
    },
    error: {
      title: "Unable to connect",
      body: "The room service is temporarily unavailable. Your link has not changed.",
    },
  }[variant];

  return (
    <main className={`${styles.shell} room-gate-shell`} id="main">
      <section
        className={`${styles.card} ${styles.state} room-state`}
        aria-live="polite"
        aria-busy={variant === "loading"}
      >
        {variant === "loading" ? (
          <span className={styles.loadingDot} aria-hidden="true" />
        ) : null}
        <div className={styles.eyebrow}>PRIVCIRCLE</div>
        <h1 className={styles.heading}>{content.title}</h1>
        <p className={styles.body}>{content.body}</p>
        {variant !== "loading" ? (
          <div className={styles.actions}>
            {variant === "error" && onRetry ? (
              <Button type="button" variant="primary" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
            {variant !== "error" ? (
              <Link className={`${styles.linkAction} ${styles.primaryLink}`} href="/?action=join">
                Enter another room
              </Link>
            ) : null}
            <Link className={styles.linkAction} href="/">
              Create new room
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
