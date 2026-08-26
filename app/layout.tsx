import type { Metadata } from "next";
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
    description: "Private, expiring collaborative code rooms for two people.",
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
    description: "Private, expiring collaborative code rooms for two people.",
    images: ["/privcircle-social.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
