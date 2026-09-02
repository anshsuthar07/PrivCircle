import { getRedis } from "@/lib/redis";
import { keys } from "@/lib/storage/keys";
import { ROOM_CAPACITY } from "@/lib/types";

const LEASE_MS = 75_000;

const claimScript = `
redis.call('zremrangebyscore', KEYS[1], '-inf', ARGV[1])
local members = redis.call('zrange', KEYS[1], 0, -1)
local seen = {}
local participantCount = 0
for _, member in ipairs(members) do
  local separator = string.find(member, ':')
  local participant = separator and string.sub(member, 1, separator - 1) or member
  if not seen[participant] then
    seen[participant] = true
    participantCount = participantCount + 1
  end
end
if not seen[ARGV[2]] and participantCount >= tonumber(ARGV[5]) then
  return 0
end
redis.call('zadd', KEYS[1], ARGV[1] + ARGV[4], ARGV[2] .. ':' .. ARGV[3])
redis.call('pexpire', KEYS[1], ARGV[4] * 2)
return participantCount + (seen[ARGV[2]] and 0 or 1)
`;

const refreshScript = `
local member = ARGV[2] .. ':' .. ARGV[3]
if not redis.call('zscore', KEYS[1], member) then
  return 0
end
redis.call('zadd', KEYS[1], ARGV[1] + ARGV[4], member)
redis.call('pexpire', KEYS[1], ARGV[4] * 2)
return 1
`;

export async function claimParticipant(
  roomId: string,
  participantId: string,
  socketId: string,
) {
  const now = Date.now();
  const result = await getRedis().eval(
    claimScript,
    1,
    keys.presence(roomId),
    now,
    participantId,
    socketId,
    LEASE_MS,
    ROOM_CAPACITY,
  );
  return Number(result) > 0;
}

export async function refreshParticipant(
  roomId: string,
  participantId: string,
  socketId: string,
) {
  const refreshed = await getRedis().eval(
    refreshScript,
    1,
    keys.presence(roomId),
    Date.now(),
    participantId,
    socketId,
    LEASE_MS,
  );
  return Number(refreshed) === 1;
}

export async function releaseParticipant(
  roomId: string,
  participantId: string,
  socketId: string,
) {
  await getRedis().zrem(
    keys.presence(roomId),
    `${participantId}:${socketId}`,
  );
}
