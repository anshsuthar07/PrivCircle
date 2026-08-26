import type { Metadata } from "next";
import { RoomClient } from "./RoomClient";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ roomPath: string }>;
}): Promise<Metadata> {
  const { roomPath } = await params;
  return {
    title: `/${roomPath.toLowerCase()} — PrivCircle`,
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomPath: string }>;
}) {
  const { roomPath } = await params;
  return <RoomClient path={roomPath.toLowerCase()} />;
}
