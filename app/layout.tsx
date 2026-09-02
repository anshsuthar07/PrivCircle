import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_ORIGIN || "http://localhost:3000"),
  title: "PrivCircle — Private live rooms",
  description:
    "Create a private, optionally password-protected room and collaborate in real time.",
  openGraph: {
    title: "PrivCircle — Private live rooms",
    description: "Private, expiring collaborative code rooms for trusted groups.",
    type: "website",
    images: [
      {
        url: "/privcircle-social.png",
        width: 1744,
        height: 901,
        alt: "PrivCircle — Private live code rooms",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PrivCircle — Private live rooms",
    description: "Private, expiring collaborative code rooms for trusted groups.",
    images: ["/privcircle-social.png"],
  },
};

/**
 * `interactiveWidget: "resizes-content"` is what keeps the editor usable on a
 * phone. The room is a full-height grid with a fixed toolbar; without this the
 * on-screen keyboard overlays the layout instead of shrinking it, and the
 * toolbar ends up underneath the keyboard exactly when someone is typing.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
