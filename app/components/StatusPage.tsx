import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./StatusPage.module.css";

/**
 * The shared shell for a whole-page outcome that is not a room.
 *
 * It mirrors the room recovery states deliberately: a person who mistypes a
 * link should land somewhere that still looks like PrivCircle and still offers
 * a way forward, rather than on a framework default page.
 */
export function StatusPage({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <main className={styles.shell} id="main">
      <section className={styles.card}>
        <div className={styles.eyebrow}>PRIVCIRCLE</div>
        <h1 className={styles.heading}>{title}</h1>
        <p className={styles.body}>{body}</p>
        <div className={styles.actions}>
          {children}
          <Link className={`${styles.linkAction} ${styles.primaryLink}`} href="/">
            Create a room
          </Link>
          <Link className={styles.linkAction} href="/?action=join">
            Join a room
          </Link>
        </div>
      </section>
    </main>
  );
}

export { styles as statusPageStyles };
