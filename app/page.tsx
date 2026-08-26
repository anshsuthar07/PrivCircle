import { CreateRoomForm } from "./components/CreateRoomForm";

const assurances = [
  "Realtime sync",
  "Private by default",
  "Join by path",
  "Optional password",
];

export default function Home() {
  return (
    <main className="home-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="home-card" aria-labelledby="home-title">
        <div className="brand-lock" aria-hidden="true">
          <span />
        </div>

        <div className="eyebrow">PRIVCIRCLE</div>
        <h1 id="home-title">Share code, not access.</h1>
        <p className="home-intro">
          Create a focused live room for two people. No account, no public
          directory, and no noise.
        </p>

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
    </main>
  );
}
