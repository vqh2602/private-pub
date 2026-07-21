import {
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
const N = 32768;
const R = 8;
const P = 3;
const KEY_LENGTH = 32;
const MAX_MEMORY = 128 * 1024 * 1024;

function derive(
  password: string,
  salt: Buffer,
  length: number,
  options: { N: number; r: number; p: number },
) {
  return new Promise<Buffer>((resolve, reject) =>
    nodeScrypt(
      password,
      salt,
      length,
      { ...options, maxmem: MAX_MEMORY },
      (error, value) => (error ? reject(error) : resolve(value)),
    ),
  );
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await derive(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, rawN, rawR, rawP, rawSalt, rawHash] = encoded.split("$");
  if (algorithm !== "scrypt" || !rawN || !rawR || !rawP || !rawSalt || !rawHash)
    return false;
  const expected = Buffer.from(rawHash, "base64url");
  const derived = await derive(
    password,
    Buffer.from(rawSalt, "base64url"),
    expected.length,
    { N: Number(rawN), r: Number(rawR), p: Number(rawP) },
  );
  return (
    expected.length === derived.length && timingSafeEqual(expected, derived)
  );
}
