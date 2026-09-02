import type { Metadata } from "next";
import { StatusPage } from "./components/StatusPage";

export const metadata: Metadata = {
  title: "Not found — PrivCircle",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <StatusPage
      title="Page not found"
      body="That address is not a PrivCircle page. Room links are a single name, like /team-session — check the link you were sent, or start a new room."
    />
  );
}
