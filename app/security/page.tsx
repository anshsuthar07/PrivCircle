import type { Metadata } from "next";
import { ROOM_CAPACITY } from "@/lib/types";
import Link from "next/link";
import styles from "./security.module.css";

export const metadata: Metadata = {
  title: "Security & privacy — PrivCircle",
  description: "How PrivCircle protects room access, transports data, and stores rooms.",
};

export default function SecurityPage() {
  return (
    <main className={styles.shell} id="main">
      <article className={styles.page}>
        <Link className={styles.brand} href="/">
          ← PRIVCIRCLE
        </Link>

        <header className={styles.header}>
          <h1>Security and privacy</h1>
          <p>
            PrivCircle minimizes public exposure and enforces room access on the
            server. This page describes the guarantees—and the limits—without
            treating privacy as a marketing shortcut.
          </p>
        </header>

        <div className={styles.notice}>
          <strong>PrivCircle is not end-to-end encrypted.</strong> The service can
          process and store room content to synchronize participants and enforce
          retention. Use it only for information appropriate for that model.
        </div>

        <div className={styles.sections}>
          <section className={styles.section}>
            <h2>Access model</h2>
            <p>
              Rooms are not listed in a public directory and no account is required.
              A room URL identifies the room; anyone with an unprotected link can
              enter. An optional password adds a separate access factor.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Password protection</h2>
            <p>
              Password verification happens on the server. Passwords are hashed with
              Argon2id and protected room content does not connect to the collaborative
              editor until authentication succeeds.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Transport and collaboration</h2>
            <p>
              Production traffic uses HTTPS and secure WebSockets. Participants
              reconnect through short-lived, room-bound access tokens, and a room
              admits <strong>up to {ROOM_CAPACITY} people at a time</strong> — the
              next participant is refused by the server, not merely hidden.
            </p>
          </section>

          <section className={styles.section} id="files">
            <h2>Temporary files</h2>
            <p>
              Files attached to a room are stored by the hosting provider and are
              reachable only after the same authorization the room itself requires.
              They are never rendered or executed by PrivCircle.
            </p>
            <ul>
              <li>
                A room holds <strong>300 MB of files in total</strong>, and each
                file is deleted <strong>24 hours after it is uploaded</strong>.
                This is its own clock, independent of the room&apos;s retention.
              </li>
              <li>
                A file therefore <strong>can outlive a shorter room</strong> — a
                1-hour room&apos;s files are reclaimed on the file&apos;s schedule,
                or sooner once the room itself is gone. They are unreachable in
                the meantime, because every request resolves the room first.
              </li>
              <li>Only the person who shared a file can remove it early.</li>
            </ul>
          </section>

          <section className={styles.section} id="retention">
            <h2>Retention</h2>
            <ul>
              <li>
                Expiring rooms use a 1-hour, 24-hour, or 7-day inactivity policy. The
                timer restarts when the room is reopened, connected, or edited.
              </li>
              <li>
                <strong>No automatic expiry</strong> stores room data until operator
                removal, database removal, or provider limits intervene.
              </li>
              <li>
                The shared document is capped at <strong>1 MB</strong>. Beyond
                that the room tells you it has stopped saving rather than
                silently discarding the excess.
              </li>
              <li>PrivCircle currently has no self-service room deletion.</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2>Operational limits</h2>
            <p>
              Provider outages, quotas, deployment limits, or database loss can make
              rooms unavailable. “No automatic expiry” is a retention setting, not a
              promise of permanent preservation.
            </p>
          </section>
        </div>

        <footer className={styles.footer}>
          <Link className={styles.link} href="/">
            Create or join a room
          </Link>
          <a
            className={styles.link}
            href="https://github.com/anshsuthar07/PrivCircle"
          >
            Review the source
          </a>
        </footer>
      </article>
    </main>
  );
}
