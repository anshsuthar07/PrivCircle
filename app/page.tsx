import { CreateRoomForm } from "./components/CreateRoomForm";

const assurances = [
  "Realtime sync",
  "Private by default",
  "Join by path",
  "Optional password",
];

const features = [
  {
    icon: "shield",
    title: "Argon2id passwords",
    description: "Strong password hashing for protected rooms.",
  },
  {
    icon: "private",
    title: "No public footprint",
    description: "No accounts, profiles, or searchable room directory.",
  },
  {
    icon: "sync",
    title: "Realtime collaboration",
    description: "Yjs keeps concurrent edits in sync without conflicts.",
  },
  {
    icon: "lock",
    title: "Late-join guard",
    description: "Protected content stays disconnected until authentication.",
  },
] as const;

export default function Home() {
  return (
    <main className="home-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <div className="home-layout">
        <section className="home-story" aria-labelledby="home-title">
          <div className="home-brand">
            <div className="brand-lock" aria-hidden="true">
              <span />
            </div>
            <span>PRIVCIRCLE</span>
          </div>

          <div className="home-hero-copy">
            <h1 id="home-title">
              Share code,
              <br />
              <span>not access.</span>
            </h1>
            <p className="home-intro">
              Private live rooms for two. No account required, no public
              directory, and protected content stays locked until you authenticate.
            </p>
          </div>

          <div className="feature-grid" aria-label="Privacy and collaboration features">
            {features.map((feature) => (
              <article className="feature-card" key={feature.title}>
                <FeatureIcon name={feature.icon} />
                <h2>{feature.title}</h2>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <div className="home-form-column">
          <section className="home-card" aria-label="Create or join a private room">
            <CreateRoomForm />

            <div className="assurances" aria-label="Room features">
              {assurances.map((assurance) => (
                <div className="assurance" key={assurance}>
                  <span className="checkmark" aria-hidden="true">
                    ✓
                  </span>
                  {assurance}
                </div>
              ))}
            </div>

            <p className="privacy-note">
              Room URLs are never listed publicly. Passwords use Argon2id, and
              protected content stays disconnected until authentication succeeds.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

function FeatureIcon({ name }: { name: (typeof features)[number]["icon"] }) {
  return (
    <span className="feature-icon" aria-hidden="true">
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
