const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE = BigInt(ALPHABET.length);
const CHAR_MAP = Object.fromEntries([...ALPHABET].map((c, i) => [c, BigInt(i)]));

export const encode = (bytes: Uint8Array): string => {
  let n = bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
  const chars: string[] = [];
  while (n > 0n) { chars.push(ALPHABET[Number(n % BASE)]!); n /= BASE; }
  for (const b of bytes) { if (b !== 0) break; chars.push(ALPHABET[0]!); }
  return chars.reverse().join("");
};

export const decode = (s: string): Uint8Array => {
  let n = [...s].reduce((acc, c) => {
    const v = CHAR_MAP[c];
    if (v === undefined) throw new Error(`Invalid base58 character: ${c}`);
    return acc * BASE + v;
  }, 0n);
  const hex = n === 0n ? "" : n.toString(16).padStart(2, "0");
  const padded = hex.length % 2 ? "0" + hex : hex;
  const bytes = new Uint8Array((padded.length / 2) || 0);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  const leadingZeros = [...s].findIndex((c) => c !== ALPHABET[0]);
  const prefix = new Uint8Array(leadingZeros === -1 ? s.length : leadingZeros);
  const result = new Uint8Array(prefix.length + bytes.length);
  result.set(prefix); result.set(bytes, prefix.length);
  return result;
};

export const hexToBase58 = (hex: string): string => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return encode(bytes);
};

export const base58ToHex = (b58: string): string =>
  [...decode(b58)].map((b) => b.toString(16).padStart(2, "0")).join("");
