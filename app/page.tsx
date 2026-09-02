import Image from "next/image";
import Link from "next/link";
import { CreateRoomForm } from "./components/CreateRoomForm";
import styles from "./home.module.css";

/**
 * Each card leads with what someone gets and keeps the mechanism as the
 * evidence for it. The previous set named the mechanisms only — "Argon2id
 * passwords", "Late-join guard" — which read as a security datasheet and never
 * told a first-time visitor what the product actually does.
 */
const features = [
  {
    icon: "sync",
    title: "Edit together, instantly",
    description:
      "Your whole group in one document, every keystroke shared live. Conflict-free, powered by Yjs.",
  },
  {
    icon: "private",
    title: "Nothing to sign up for",
    description:
      "No account, no profile, no directory to browse. A room is just a link you share.",
  },
  {
    icon: "lock",
    title: "Locked means locked",
    description:
      "A protected room loads nothing until the password checks out on the server, not in the browser.",
  },
  {
    icon: "shield",
    title: "Gone when you say",
    description:
      "Pick 1 hour, 24 hours, 7 days, or keep it. The countdown restarts whenever the room is in use.",
  },
] as const;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ action?: string | string[] }>;
}) {
  const query = await searchParams;
  const initialAction = query.action === "join" ? "join" : "create";

  return (
    <main className={styles.shell} id="main">
      <div className={`${styles.ambient} ${styles.ambientOne}`} />
      <div className={`${styles.ambient} ${styles.ambientTwo}`} />

      <div className={`${styles.layout} home-layout`}>
        <section className={`${styles.hero} home-story`} aria-labelledby="home-title">
          <div className={styles.brand}>
            <Image
              className={styles.brandIcon}
              src="/icon.svg"
              width={36}
              height={36}
              alt=""
              priority
            />
            <span>PRIVCIRCLE</span>
          </div>

          <div>
            <h1 className={styles.title} id="home-title">
              Share code,
              <br />
              <span>not access.</span>
            </h1>
            <p className={styles.intro}>
              PrivCircle is a private code editor for your group. Create a room,
              send the link, edit together in real time, and share files — no
              account, no public directory, and nothing loaded until you are let
              in.
            </p>
          </div>
        </section>

        <div className={`${styles.formColumn} home-form-column`}>
          <section className={`${styles.card} home-card`} aria-label="Create or join a private room">
            <CreateRoomForm initialAction={initialAction} />
          </section>
        </div>

        <section className={styles.proof} aria-labelledby="proof-title">
          <div className={styles.proofHeader}>
            <h2 id="proof-title">Built for focused collaboration</h2>
            <p>
              Deliberately contained: one shared document, one group, and
              attached files that clean themselves up.
            </p>
          </div>
          <div className={`${styles.featureGrid} feature-grid`}>
            {features.map((feature) => (
              <article className={styles.featureCard} key={feature.title}>
                <FeatureIcon name={feature.icon} />
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <footer className={styles.footer}>
          <span>Private code rooms with server-enforced access controls.</span>
          <nav aria-label="Product information">
            <Link href="/security">Security &amp; privacy</Link>
            <Link href="/security#retention">Retention model</Link>
            <a href="https://github.com/anshsuthar07/PrivCircle">Source</a>
          </nav>
        </footer>
      </div>
    </main>
  );
}

function FeatureIcon({ name }: { name: (typeof features)[number]["icon"] }) {
  return (
    <span className={styles.featureIcon} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        {name === "shield" ? (
          <path d="M12 3 19 6v5c0 4.7-2.7 8-7 10-4.3-2-7-5.3-7-10V6l7-3Z" />
        ) : null}
        {name === "private" ? (
          <>
            <circle cx="12" cy="12" r="8" />
            <path d="m9.2 12 1.8 1.8 4-4" />
          </>
        ) : null}
        {name === "sync" ? (
          <>
            <path d="M5 8h11l-3-3" />
            <path d="M19 16H8l3 3" />
          </>
        ) : null}
        {name === "lock" ? (
          <>
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </>
        ) : null}
      </svg>
    </span>
  );
}
