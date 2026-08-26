const prefix = "privcircle";

export const keys = {
  path: (path: string) => `${prefix}:path:${path}`,
  room: (roomId: string) => `${prefix}:room:${roomId}`,
  document: (roomId: string) => `${prefix}:document:${roomId}`,
  tombstone: (path: string) => `${prefix}:expired:${path}`,
  grant: (roomId: string, sessionHash: string) =>
    `${prefix}:grant:${roomId}:${sessionHash}`,
  presence: (roomId: string) => `${prefix}:presence:${roomId}`,
  rateLimit: (scope: string, subject: string) =>
    `${prefix}:rate:${scope}:${subject}`,
};
