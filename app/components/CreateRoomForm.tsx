"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  evaluatePassword,
  isStrongPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";
import { parseJoinPathInput } from "@/lib/path-policy";

type Expiration = "1h" | "24h" | "7d" | "lifetime";
type RoomAction = "create" | "join";

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
  const [action, setAction] = useState<RoomAction>("create");
  const [path, setPath] = useState("");
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [password, setPassword] = useState("");
  const [expiration, setExpiration] = useState<Expiration>("24h");
  const [error, setError] = useState("");
  const [collisionPath, setCollisionPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const passwordCriteria = evaluatePassword(password);
  const passwordScore = Object.values(passwordCriteria).filter(Boolean).length;
  const passwordReady = !passwordProtected || isStrongPassword(password);
  const joinPath = parseJoinPathInput(path);
  const actionReady = action === "join" ? Boolean(joinPath) : passwordReady;
  const strengthLabel =
    password.length === 0
      ? "Start typing"
      : ["Weak", "Weak", "Fair", "Almost there", "Strong"][passwordScore];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCollisionPath("");

    if (action === "join") {
      if (!joinPath) {
        setError("Enter a valid room path or shared PrivCircle link.");
        return;
      }
      setSubmitting(true);
      router.push(`/${joinPath}`);
      return;
    }

    if (!passwordReady) {
      setError(
        `Use ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters with a letter, number, and special character.`,
      );
      return;
    }

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

  function selectAction(nextAction: RoomAction) {
    setAction(nextAction);
    setError("");
    setCollisionPath("");
    setSubmitting(false);
  }

  return (
    <form className="create-form" onSubmit={handleSubmit}>
      <div className="room-action-switch" role="group" aria-label="Room action">
        <button
          type="button"
          className={action === "create" ? "active" : ""}
          aria-pressed={action === "create"}
          onClick={() => selectAction("create")}
        >
          Create room
        </button>
        <button
          type="button"
          className={action === "join" ? "active" : ""}
          aria-pressed={action === "join"}
          onClick={() => selectAction("join")}
        >
          Join room
        </button>
      </div>

      <div className="field-group">
        <div className="label-row">
          <label htmlFor="room-path">Room path</label>
          {action === "create" ? (
            <button
              className="text-button"
              type="button"
              onClick={() => setPath(randomPath())}
            >
              Generate secure path
            </button>
          ) : null}
        </div>
        <div className={`path-field ${action === "join" ? "join-path-field" : ""}`}>
          <span aria-hidden="true">{action === "join" ? "→" : "/"}</span>
          <input
            id="room-path"
            name="path"
            type="text"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder={
              action === "join" ? "room path or paste shared link" : "e.g. devteam-sprint1"
            }
            minLength={action === "create" ? 3 : undefined}
            maxLength={action === "create" ? 64 : 2048}
            pattern={action === "create" ? "[A-Za-z0-9_-]+" : undefined}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={action === "join" && path.length > 0 && !joinPath}
            aria-describedby="room-path-hint"
          />
        </div>
        <p
          className={`field-hint ${
            action === "join" && path.length > 0 && !joinPath
              ? "field-hint-error"
              : ""
          }`}
          id="room-path-hint"
        >
          {action === "create"
            ? "Leave blank and we’ll generate one for you."
            : path.length > 0 && !joinPath
              ? "Use 3–64 letters, numbers, hyphens, or underscores."
              : "Protected rooms ask for the password on the next screen."}
        </p>
      </div>

      {action === "create" ? (
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
      ) : null}

      {action === "create" && passwordProtected ? (
        <div className="field-group reveal-field">
          <label htmlFor="room-password">Password</label>
          <div className="password-input-shell">
            <input
              className="standard-input"
              id="room-password"
              name="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Create a strong password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              autoComplete="new-password"
              aria-describedby="password-requirements"
              required
            />
            <button
              className="password-visibility"
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <div
            className="password-strength"
            id="password-requirements"
            aria-live="polite"
          >
            <div className="password-strength-heading">
              <span>Password strength</span>
              <strong data-score={passwordScore}>{strengthLabel}</strong>
            </div>
            <div className="strength-meter" aria-hidden="true">
              {[1, 2, 3, 4].map((step) => (
                <span key={step} className={passwordScore >= step ? "filled" : ""} />
              ))}
            </div>
            <ul className="password-criteria">
              <PasswordCriterion
                met={passwordCriteria.length}
                label={`${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`}
              />
              <PasswordCriterion met={passwordCriteria.letter} label="One letter" />
              <PasswordCriterion met={passwordCriteria.number} label="One number" />
              <PasswordCriterion
                met={passwordCriteria.special}
                label="One special character"
              />
            </ul>
          </div>
        </div>
      ) : null}

      {action === "create" ? (
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
      ) : null}

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

      <button
        className="primary-button"
        type="submit"
        disabled={submitting || !actionReady}
        aria-busy={submitting}
      >
        {submitting
          ? action === "create"
            ? "Creating secure room…"
            : "Opening room…"
          : action === "create"
            ? "Create private room"
            : "Join this room"}
        {!submitting ? <span aria-hidden="true">→</span> : null}
      </button>
    </form>
  );
}

function PasswordCriterion({ met, label }: { met: boolean; label: string }) {
  return (
    <li className={met ? "criterion-met" : ""}>
      <span aria-hidden="true">{met ? "✓" : "○"}</span>
      <span>{label}</span>
      <span className="sr-only">{met ? " met" : " not met"}</span>
    </li>
  );
}
