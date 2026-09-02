"use client";

import "./globals.css";

/**
 * Replaces the root layout when the layout itself fails, so it has to render
 * its own document. Kept dependency-free and inline-styled for that reason.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main
          style={{
            display: "grid",
            minHeight: "100dvh",
            placeItems: "center",
            padding: "24px",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <section style={{ maxWidth: "440px" }}>
            <p
              style={{
                marginBottom: "12px",
                color: "#72e8aa",
                font: "600 12px/1 monospace",
                letterSpacing: "0.16em",
              }}
            >
              PRIVCIRCLE
            </p>
            <h1 style={{ fontSize: "28px", lineHeight: "36px" }}>
              PrivCircle could not start
            </h1>
            <p style={{ marginTop: "12px", color: "#98a69f", lineHeight: "22px" }}>
              Something failed before the page could load{error.digest ? ` (${error.digest})` : ""}.
              Your room link has not changed.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: "44px",
                marginTop: "24px",
                border: 0,
                borderRadius: "12px",
                padding: "0 16px",
                color: "#092015",
                background: "#72e8aa",
                cursor: "pointer",
                font: "600 14px/1 system-ui, sans-serif",
              }}
            >
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
