"use client";

import { useEffect } from "react";
import { Button } from "./components/ui/controls";
import { StatusPage } from "./components/StatusPage";

/**
 * The last line of defence for a client-side render failure.
 *
 * `digest` is the only identifier Next exposes for the corresponding server
 * log line, and it is the only thing shown: the error itself may name internals
 * and never reaches the page.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        scope: "app.render",
        name: error.name,
        digest: error.digest,
        at: new Date().toISOString(),
      }),
    );
  }, [error]);

  return (
    <StatusPage
      title="Something went wrong"
      body="This page could not be displayed. Your room link has not changed — try again, or open it fresh."
    >
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </StatusPage>
  );
}
