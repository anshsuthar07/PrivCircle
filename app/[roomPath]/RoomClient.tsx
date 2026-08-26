"use client";

import { FormEvent, lazy, Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { SafeRoomMetadata } from "@/lib/types";

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

async function readPayload(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export function RoomClient({ path }: { path: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [metadata, setMetadata] = useState<SafeRoomMetadata | null>(null);
  const [access, setAccess] = useState<AccessPayload | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
    setAccess(nextAccess);
    return nextAccess;
  }, [path]);

  useEffect(() => {
    const controller = new AbortController();

    async function enterRoom() {
      setPhase("loading");
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

        setMetadata(payload as unknown as SafeRoomMetadata);
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
    }

    void enterRoom();
    return () => controller.abort();
  }, [path, requestAccess]);

  const getAccessToken = useCallback(async () => {
    if (
      access &&
      new Date(access.tokenExpiresAt).getTime() - Date.now() > 30_000
    ) {
      return access.accessToken;
    }
    return (await requestAccess()).accessToken;
  }, [access, requestAccess]);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
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
          setMessage("Too many attempts. Please wait before trying again.");
        } else if (response.status >= 500) {
          setMessage("The room service is unavailable. Please try again.");
        } else {
          setMessage("Incorrect password. Please try again.");
        }
        return;
      }
      setAccess(payload as unknown as AccessPayload);
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
      <Suspense fallback={<RoomState title="Opening editor…" busy />}>
        <RealtimeEditor
          path={path}
          metadata={metadata}
          participantId={access.participantId}
          getAccessToken={getAccessToken}
        />
      </Suspense>
    );
  }

  if (phase === "locked") {
    return (
      <main className="room-gate-shell">
        <section className="room-gate" aria-labelledby="private-room-title">
          <div className="gate-lock" aria-hidden="true">⌁</div>
          <div className="eyebrow">PRIVATE ROOM</div>
          <h1 id="private-room-title">Password required</h1>
          <p>Enter the room password before any document data is connected or loaded.</p>
          <form className="gate-form" onSubmit={authenticate}>
            <label htmlFor="join-password">Room password</label>
            <input
              id="join-password"
              className="standard-input"
              type="password"
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
              autoFocus
              required
            />
            {message ? <div className="gate-error" role="alert">{message}</div> : null}
            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? "Checking…" : "Join room"}
            </button>
          </form>
          <p className="room-path-label">/{path}</p>
        </section>
      </main>
    );
  }

  if (phase === "expired") {
    return <RoomState title="Room expired" body="This room is no longer available." />;
  }
  if (phase === "unavailable") {
    return <RoomState title="Room unavailable" body="Check the private link or create a new room." />;
  }
  if (phase === "error") {
    return <RoomState title="Unable to connect" body="The room service is temporarily unavailable." />;
  }
  return <RoomState title="Opening private room…" busy />;
}

function RoomState({
  title,
  body,
  busy = false,
}: {
  title: string;
  body?: string;
  busy?: boolean;
}) {
  return (
    <main className="room-gate-shell">
      <section className="room-state" aria-live="polite">
        {busy ? <span className="loading-dot" aria-hidden="true" /> : null}
        <div className="eyebrow">PRIVCIRCLE</div>
        <h1>{title}</h1>
        {body ? <p>{body}</p> : null}
        {!busy ? <Link className="secondary-link" href="/">Create a room</Link> : null}
      </section>
    </main>
  );
}
