import * as argon2 from "argon2";
import type { HashOptions } from "argon2";

const options: HashOptions & { raw: false } = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
  raw: false,
};

let dummyHash: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, options);
}

export async function verifyPassword(hash: string, password: string) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function verifyDummyPassword(password: string) {
  dummyHash ??= hashPassword("privcircle-nonexistent-room");
  await verifyPassword(await dummyHash, password);
}
