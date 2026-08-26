"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  evaluatePassword,
  isStrongPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";
import {
  getRoomPathIssue,
  normalizeRoomPath,
  parseJoinPathInput,
  type RoomPathIssue,
} from "@/lib/path-policy";
import {
  Button,
  FormField,
  InfoTooltip,
  PasswordInput,
  Select,
  StatusMessage,
  SwitchField,
  TextInput,
} from "./ui/controls";
import styles from "./CreateRoomForm.module.css";

type Expiration = "1h" | "24h" | "7d" | "lifetime";
export type RoomAction = "create" | "join";

interface CreateRoomResponse {
  path: string;
}

function randomPath() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function pathIssueMessage(issue: RoomPathIssue) {
  switch (issue) {
    case "too-short":
      return "Use at least 3 characters.";
    case "too-long":
      return "Use no more than 64 characters.";
    case "invalid-characters":
      return "Use only letters, numbers, hyphens, or underscores.";
    case "reserved":
      return "That link name is reserved. Choose a different one.";
    default:
      return "";
  }
}

export function CreateRoomForm({
  initialAction = "create",
}: {
  initialAction?: RoomAction;
}) {
  const router = useRouter();
  const pathInputRef = useRef<HTMLInputElement>(null);
  const navigationTimerRef = useRef<number | null>(null);
  const [action, setAction] = useState<RoomAction>(initialAction);
  const [path, setPath] = useState("");
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [password, setPassword] = useState("");
  const [expiration, setExpiration] = useState<Expiration>("24h");
  const [pathError, setPathError] = useState("");
  const [formError, setFormError] = useState("");
  const [collisionPath, setCollisionPath] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    return () => {
      if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current);
    };
  }, []);

  const normalizedPath = normalizeRoomPath(path);
  const createPathIssue = path.trim() ? getRoomPathIssue(path) : null;
  const joinPath = parseJoinPathInput(
    path,
    typeof window === "undefined" ? undefined : window.location.origin,
  );
  const livePathError =
    action === "create"
      ? pathIssueMessage(createPathIssue)
      : path.length > 0 && !joinPath
        ? /^https?:\/\//i.test(path)
          ? "Paste a link from this PrivCircle site, or enter only the room name."
          : "Use 3–64 letters, numbers, hyphens, or underscores."
        : "";
  const displayedPathError = pathError || livePathError;

  const passwordCriteria = evaluatePassword(password);
  const passwordScore = Object.values(passwordCriteria).filter(Boolean).length;
  const passwordReady = !passwordProtected || isStrongPassword(password);
  const actionReady =
    action === "join"
      ? Boolean(joinPath)
      : createPathIssue === null && passwordReady;
  const strengthLabel =
    password.length === 0
      ? "Start typing"
      : ["Weak", "Weak", "Fair", "Almost there", "Strong"][passwordScore];

  function focusPathError(message: string) {
    setPathError(message);
    window.requestAnimationFrame(() => pathInputRef.current?.focus());
  }

  function navigateToRoom(destination: string) {
    const startingLocation = window.location.pathname + window.location.search;
    setSubmitting(true);
    router.push(destination);
    navigationTimerRef.current = window.setTimeout(() => {
      if (window.location.pathname + window.location.search === startingLocation) {
        setSubmitting(false);
        setFormError("Navigation took too long. Check your connection and try again.");
      }
    }, 8_000);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPathError("");
    setFormError("");
    setCollisionPath("");

    if (action === "join") {
      if (!joinPath) {
        focusPathError("Enter a valid room name or a link from this PrivCircle site.");
        return;
      }
      navigateToRoom(`/${joinPath}`);
      return;
    }

    if (createPathIssue) {
      focusPathError(pathIssueMessage(createPathIssue));
      return;
    }

    if (!passwordReady) {
      setFormError(
        `Use ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters with a letter, number, and special character.`,
      );
      return;
    }

    setSubmitting(true);
    let navigating = false;

    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: normalizedPath || undefined,
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
        const existingPath = payload.path || normalizedPath;
        setCollisionPath(existingPath);
        focusPathError("A room already uses this link name.");
        return;
      }

      if (!response.ok) {
        if (payload.code === "INVALID_PATH" || payload.code === "INVALID_INPUT") {
          focusPathError(payload.message || "Choose a different room link name.");
        } else {
          setFormError(payload.message || "Could not create the room. Please try again.");
        }
        return;
      }

      sessionStorage.setItem(`privcircle:created:${payload.path}`, "true");
      navigating = true;
      navigateToRoom(`/${payload.path}`);
    } catch {
      setFormError("The room service is unavailable. Please try again shortly.");
    } finally {
      if (!navigating) setSubmitting(false);
    }
  }

  function selectAction(nextAction: RoomAction) {
    setAction(nextAction);
    setPathError("");
    setFormError("");
    setCollisionPath("");
    setSubmitting(false);
  }

  const pathDescriptionId = displayedPathError ? "room-link-error" : "room-link-hint";

  return (
    <form
      className={`${styles.form} create-form`}
      onSubmit={handleSubmit}
      aria-busy={submitting}
      noValidate
    >
      <div className={styles.heading}>
        <h2>{action === "create" ? "Create a code room" : "Join a room"}</h2>
        <p>
          {action === "create"
            ? "Choose how the room is accessed and how long it remains available."
            : "Enter the room name or paste the PrivCircle link you received."}
        </p>
      </div>

      <div
        className={`${styles.actionSwitch} room-action-switch`}
        role="group"
        aria-label="Room action"
      >
        <button
          type="button"
          className={action === "create" ? styles.active : ""}
          aria-pressed={action === "create"}
          onClick={() => selectAction("create")}
        >
          Create room
        </button>
        <button
          type="button"
          className={action === "join" ? styles.active : ""}
          aria-pressed={action === "join"}
          onClick={() => selectAction("join")}
        >
          Join room
        </button>
      </div>

      <FormField
        id="room-link"
        label={action === "create" ? "Room name" : "Room link"}
        optional={action === "create" ? "(optional)" : undefined}
        action={
          action === "create" ? (
            <Button
              className={styles.textAction}
              type="button"
              variant="ghost"
              size="compact"
              aria-label="Generate random identifier"
              onClick={() => {
                setPath(randomPath());
                setPathError("");
              }}
            >
              Generate
            </Button>
          ) : null
        }
        error={displayedPathError || undefined}
        hint={
          action === "create" ? (
            <span className={styles.pathPreview}>
              /{normalizedPath || "random-name-generated-on-create"}
            </span>
          ) : (
            "Protected rooms ask for the password on the next screen."
          )
        }
      >
        <div className={styles.controlWithInfo}>
          <div className={styles.pathShell}>
            {action === "create" ? (
              <span className={styles.pathPrefix} aria-hidden="true">
                /
              </span>
            ) : null}
            <TextInput
              ref={pathInputRef}
              className={action === "create" ? styles.pathInput : styles.joinInput}
              id="room-link"
              name="path"
              type="text"
              value={path}
              onChange={(event) => {
                setPath(event.target.value);
                setPathError("");
                setFormError("");
              }}
              onBlur={() => {
                if (action === "create" && path.trim()) setPath(normalizeRoomPath(path));
              }}
              placeholder={
                action === "join" ? "Room name or PrivCircle link" : "e.g. team-session"
              }
              maxLength={action === "create" ? 64 : 2048}
              autoComplete="off"
              spellCheck={false}
              invalid={Boolean(displayedPathError)}
              aria-describedby={pathDescriptionId}
              aria-errormessage={displayedPathError ? "room-link-error" : undefined}
            />
          </div>
          <InfoTooltip label="Room naming guidance">
            Leave blank—we&apos;ll create a random room name for you.
          </InfoTooltip>
        </div>
      </FormField>

      {action === "create" ? (
        <SwitchField
          label="Password protected"
          optional="Optional"
          checked={passwordProtected}
          onChange={(event) => {
            setPasswordProtected(event.target.checked);
            setFormError("");
          }}
        />
      ) : null}

      {action === "create" && passwordProtected ? (
        <FormField
          id="room-password"
          label="Password"
          className={`${styles.passwordField} reveal-field`}
        >
          <PasswordInput
            id="room-password"
            name="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setFormError("");
            }}
            placeholder="Create a strong password"
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            aria-describedby="password-requirements"
            required
          />
          <div className={styles.strength} id="password-requirements">
            <div className={styles.strengthHeading}>
              <span>Password strength</span>
              <strong data-score={passwordScore} aria-live="polite">
                {strengthLabel}
              </strong>
            </div>
            <div className={styles.strengthMeter} aria-hidden="true">
              {[1, 2, 3, 4].map((step) => (
                <span
                  key={step}
                  className={passwordScore >= step ? styles.filled : ""}
                />
              ))}
            </div>
            <ul className={`${styles.criteria} password-criteria`}>
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
        </FormField>
      ) : null}

      {action === "create" ? (
        <FormField
          id="expiration"
          label="Room expiry"
          hint={
            expiration === "lifetime" ? (
              <span className={`${styles.retentionWarning} lifetime-warning`}>
                There is no self-service deletion. Storage ends only through operator
                action, database removal, or provider limits.
              </span>
            ) : undefined
          }
        >
          <div className={styles.controlWithInfo}>
            <Select
              id="expiration"
              value={expiration}
              onValueChange={(value) => setExpiration(value as Expiration)}
              options={[
                { value: "1h", label: "After 1 hour" },
                { value: "24h", label: "After 24 hours — recommended" },
                { value: "7d", label: "After 7 days" },
                { value: "lifetime", label: "No automatic expiry" },
              ]}
            />
            <InfoTooltip label="Retention countdown information">
              The countdown starts after the last person disconnects. Reopening or
              editing resets it.
            </InfoTooltip>
          </div>
        </FormField>
      ) : null}

      {formError ? (
        <StatusMessage className={styles.formError} tone="error">
          {formError}
        </StatusMessage>
      ) : null}

      {collisionPath ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => navigateToRoom(`/${collisionPath}`)}
        >
          Join existing room
        </Button>
      ) : null}

      <Button
        type="submit"
        size="main"
        disabled={submitting || !actionReady}
        aria-busy={submitting}
      >
        {submitting
          ? action === "create"
            ? "Creating room…"
            : "Opening room…"
          : action === "create"
            ? passwordProtected
              ? "Create protected room"
              : "Create room"
            : "Join room"}
        {!submitting ? <span aria-hidden="true">→</span> : null}
      </Button>

      <p className={styles.securityNote}>
        PrivCircle uses server-enforced access controls and encrypted transport. It is
        not end-to-end encrypted. <Link href="/security">How security works</Link>
      </p>
    </form>
  );
}

function PasswordCriterion({ met, label }: { met: boolean; label: string }) {
  return (
    <li className={met ? `${styles.met} criterion-met` : ""}>
      <span aria-hidden="true">{met ? "✓" : "○"}</span>
      <span>{label}</span>
      <span className="sr-only">{met ? " met" : " not met"}</span>
    </li>
  );
}
