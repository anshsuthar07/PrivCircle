"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Expiration = "1h" | "24h" | "7d" | "lifetime";

interface CreateRoomResponse {
  path: string;
}

function randomPath() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function CreateRoomForm() {
  const router = useRouter();
  const [path, setPath] = useState("");
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [password, setPassword] = useState("");
  const [expiration, setExpiration] = useState<Expiration>("24h");
  const [error, setError] = useState("");
  const [collisionPath, setCollisionPath] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCollisionPath("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: path.trim() || undefined,
          passwordProtected,
          password: passwordProtected ? password : undefined,
          expiration,
        }),
      });

      const payload = (await response.json()) as CreateRoomResponse & {
        code?: string;
        message?: string;
      };

      if (response.status === 409) {
        setCollisionPath(payload.path || path.trim().toLowerCase());
        setError("Room already exists.");
        return;
      }

      if (!response.ok) {
        setError(payload.message || "Could not create the room. Please try again.");
        return;
      }

      router.push(`/${payload.path}`);
    } catch {
      setError("The room service is unavailable. Please try again shortly.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="create-form" onSubmit={handleSubmit}>
      <div className="field-group">
        <div className="label-row">
          <label htmlFor="room-path">Room path</label>
          <button
            className="text-button"
            type="button"
            onClick={() => setPath(randomPath())}
          >
            Generate secure path
          </button>
        </div>
        <div className="path-field">
          <span aria-hidden="true">/</span>
          <input
            id="room-path"
            name="path"
            type="text"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="e.g. devteam-sprint1"
            minLength={3}
            maxLength={64}
            pattern="[A-Za-z0-9_-]+"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <p className="field-hint">Leave blank and we&apos;ll generate one for you.</p>
      </div>

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={passwordProtected}
          onChange={(event) => setPasswordProtected(event.target.checked)}
        />
        <span className="toggle" aria-hidden="true">
          <span />
        </span>
        <span>
          Password protected <small>Optional</small>
        </span>
      </label>

      {passwordProtected ? (
        <div className="field-group reveal-field">
          <label htmlFor="room-password">Password</label>
          <input
            className="standard-input"
            id="room-password"
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </div>
      ) : null}

      <div className="field-group">
        <label htmlFor="expiration">Delete after inactivity</label>
        <div className="select-wrap">
          <select
            id="expiration"
            value={expiration}
            onChange={(event) => setExpiration(event.target.value as Expiration)}
          >
            <option value="1h">1 hour</option>
            <option value="24h">24 hours — recommended</option>
            <option value="7d">7 days</option>
            <option value="lifetime">Lifetime — stored until removed</option>
          </select>
          <span aria-hidden="true">⌄</span>
        </div>
        {expiration === "lifetime" ? (
          <p className="lifetime-warning">
            Stored in PostgreSQL until manually removed, the database is deleted,
            or provider limits intervene.
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="form-error" role="alert">
          <span>{error}</span>
          {collisionPath ? (
            <button type="button" onClick={() => router.push(`/${collisionPath}`)}>
              Join it →
            </button>
          ) : null}
        </div>
      ) : null}

      <button className="primary-button" type="submit" disabled={submitting}>
        {submitting ? "Creating secure room…" : "Create private room"}
        {!submitting ? <span aria-hidden="true">→</span> : null}
      </button>
    </form>
  );
}
