// Čtení Excelu zašifrovaného heslem (Soubor → Informace → Zamknout sešit → Šifrovat pomocí hesla).
// Excel 2010+ ukládá šifrovaný sešit jako složený soubor (CFB) s proudy EncryptionInfo a EncryptedPackage
// a šifrováním „Agile“ (MS-OFFCRYPTO 2.3.4.10): klíč z hesla přes SHA-512 se 100 000 opakováními, data AES-CBC.
// Rozšifruje se jen v paměti; heslo ani rozšifrovaná data se nikam neukládají.

import { sha512 } from './sha512';

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

const startsWith = (bytes: Uint8Array, signature: readonly number[]) => signature.every((b, i) => bytes[i] === b);

/** Soubor je šifrovaný sešit Office (složený soubor místo ZIP). */
export const isEncryptedOffice = (buffer: ArrayBuffer) => startsWith(new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength)), CFB_SIGNATURE);
/** Soubor je běžný sešit .xlsx (ZIP). */
export const isPlainXlsx = (buffer: ArrayBuffer) => startsWith(new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength)), ZIP_SIGNATURE);

export type OfficeCryptoCode = 'notEncrypted' | 'unsupported' | 'wrongPassword' | 'corrupt';

export class OfficeCryptoError extends Error {
  readonly code: OfficeCryptoCode;
  constructor(code: OfficeCryptoCode, message: string = code) {
    super(message);
    this.code = code;
  }
}

// --- Složený soubor (Compound File Binary, MS-CFB): jen čtení proudů podle názvu ---

const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;

/** Proudy kořenového adresáře složeného souboru (název → obsah). */
export function readCompoundStreams(buffer: ArrayBuffer): Map<string, Uint8Array> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (!startsWith(bytes, CFB_SIGNATURE)) throw new OfficeCryptoError('notEncrypted');
  const sectorSize = 1 << view.getUint16(30, true);
  const miniSectorSize = 1 << view.getUint16(32, true);
  const firstDirSector = view.getUint32(48, true);
  const miniCutoff = view.getUint32(56, true);
  const firstMiniFat = view.getUint32(60, true);
  const firstDifat = view.getUint32(68, true);
  const offset = (sector: number) => (sector + 1) * sectorSize;
  const u32 = (pos: number) => (pos + 4 <= bytes.length ? view.getUint32(pos, true) : FREE);

  // Sektory tabulky FAT: prvních 109 v hlavičce, další v řetězu DIFAT.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = u32(76 + i * 4);
    if (s !== FREE) fatSectors.push(s);
  }
  const perSector = sectorSize / 4;
  for (let s = firstDifat, guard = 0; s !== END_OF_CHAIN && s !== FREE && guard < 10_000; guard++) {
    for (let i = 0; i < perSector - 1; i++) {
      const v = u32(offset(s) + i * 4);
      if (v !== FREE) fatSectors.push(v);
    }
    s = u32(offset(s) + (perSector - 1) * 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) for (let i = 0; i < perSector; i++) fat.push(u32(offset(s) + i * 4));

  const chain = (start: number, next: readonly number[]) => {
    const list: number[] = [];
    for (let s = start; s !== END_OF_CHAIN && s !== FREE && s < next.length && list.length <= next.length; s = next[s]!) list.push(s);
    return list;
  };
  const readChain = (start: number) => {
    const sectors = chain(start, fat);
    const out = new Uint8Array(sectors.length * sectorSize);
    sectors.forEach((s, i) => out.set(bytes.subarray(offset(s), offset(s) + sectorSize), i * sectorSize));
    return out;
  };

  // Adresář: záznamy po 128 bajtech (název UTF-16, typ, první sektor, velikost).
  const dir = readChain(firstDirSector);
  const dirView = new DataView(dir.buffer);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (let pos = 0; pos + 128 <= dir.length; pos += 128) {
    const nameLength = dirView.getUint16(pos + 64, true);
    const name = String.fromCharCode(...new Uint16Array(dir.buffer.slice(pos, pos + Math.max(0, nameLength - 2))));
    entries.push({ name, type: dir[pos + 66]!, start: dirView.getUint32(pos + 116, true), size: dirView.getUint32(pos + 120, true) });
  }
  const root = entries.find((e) => e.type === 5);
  if (!root) throw new OfficeCryptoError('corrupt', 'chybí kořen složeného souboru');
  const miniStream = readChain(root.start);
  const miniFat: number[] = [];
  const miniFatBytes = readChain(firstMiniFat);
  const miniView = new DataView(miniFatBytes.buffer);
  for (let pos = 0; pos + 4 <= miniFatBytes.length; pos += 4) miniFat.push(miniView.getUint32(pos, true));

  const streams = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (e.type !== 2) continue;
    if (e.size < miniCutoff) {
      const sectors = chain(e.start, miniFat);
      const out = new Uint8Array(sectors.length * miniSectorSize);
      sectors.forEach((s, i) => out.set(miniStream.subarray(s * miniSectorSize, (s + 1) * miniSectorSize), i * miniSectorSize));
      streams.set(e.name, out.subarray(0, e.size));
    } else streams.set(e.name, readChain(e.start).subarray(0, e.size));
  }
  return streams;
}

// --- Šifrování Agile ---

const BLOCK_VERIFIER_INPUT = [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79];
const BLOCK_VERIFIER_VALUE = [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e];
const BLOCK_KEY_VALUE = [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6];
const SEGMENT = 4096;

interface AgileInfo {
  keyData: { salt: Uint8Array; blockSize: number; keyBits: number; hash: string };
  password: {
    salt: Uint8Array;
    spinCount: number;
    blockSize: number;
    keyBits: number;
    hash: string;
    verifierInput: Uint8Array;
    verifierHash: Uint8Array;
    keyValue: Uint8Array;
  };
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

function attribute(xml: string, element: string, name: string): string {
  const tag = new RegExp(`<(?:\\w+:)?${element}\\b[^>]*>`).exec(xml)?.[0];
  const value = tag && new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
  if (value === undefined) throw new OfficeCryptoError('unsupported', `chybí ${element}.${name}`);
  return value;
}

/** Popis šifrování z proudu EncryptionInfo (verze 4.4 = Agile, popis v XML). */
export function parseEncryptionInfo(info: Uint8Array): AgileInfo {
  const view = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const major = view.getUint16(0, true);
  const minor = view.getUint16(2, true);
  if (major !== 4 || minor !== 4) throw new OfficeCryptoError('unsupported', `šifrování verze ${major}.${minor}`);
  const xml = new TextDecoder().decode(info.subarray(8));
  const keyEncryptor = /<(?:\w+:)?encryptedKey\b[^>]*>/.exec(xml)?.[0] ?? '';
  const read = (name: string) => {
    const value = new RegExp(`\\b${name}="([^"]*)"`).exec(keyEncryptor)?.[1];
    if (value === undefined) throw new OfficeCryptoError('unsupported', `chybí encryptedKey.${name}`);
    return value;
  };
  const hash = (name: string) => {
    if (!/^SHA(-?)(1|256|384|512)$/i.test(name)) throw new OfficeCryptoError('unsupported', `hash ${name}`);
    return name.toUpperCase().replace(/^SHA-?/, 'SHA-');
  };
  if (!/^AES$/i.test(attribute(xml, 'keyData', 'cipherAlgorithm')) || !/^ChainingModeCBC$/i.test(attribute(xml, 'keyData', 'cipherChaining')))
    throw new OfficeCryptoError('unsupported', 'šifra');
  return {
    keyData: {
      salt: fromBase64(attribute(xml, 'keyData', 'saltValue')),
      blockSize: Number(attribute(xml, 'keyData', 'blockSize')),
      keyBits: Number(attribute(xml, 'keyData', 'keyBits')),
      hash: hash(attribute(xml, 'keyData', 'hashAlgorithm')),
    },
    password: {
      salt: fromBase64(read('saltValue')),
      spinCount: Number(read('spinCount')),
      blockSize: Number(read('blockSize')),
      keyBits: Number(read('keyBits')),
      hash: hash(read('hashAlgorithm')),
      verifierInput: fromBase64(read('encryptedVerifierHashInput')),
      verifierHash: fromBase64(read('encryptedVerifierHashValue')),
      keyValue: fromBase64(read('encryptedKeyValue')),
    },
  };
}

const concat = (...parts: readonly ArrayLike<number>[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
};

const le32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

/** Délka upravená na požadovanou: zkrátit, nebo doplnit bajty 0x36 (MS-OFFCRYPTO 2.3.4.12). */
const fit = (bytes: Uint8Array, length: number) => (bytes.length >= length ? bytes.slice(0, length) : concat(bytes, new Uint8Array(length - bytes.length).fill(0x36)));

const digest = async (hash: string, data: Uint8Array) => new Uint8Array(await crypto.subtle.digest(hash, data as BufferSource));

/**
 * AES-CBC bez zarovnání (Office data nezarovnává). WebCrypto zarovnání vyžaduje, proto se za data přidá blok,
 * který se rozšifruje na platné zarovnání: zašifrování prázdných dat s IV = poslední blok šifry.
 */
async function aesCbcRaw(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (data.length === 0 || data.length % 16) throw new OfficeCryptoError('corrupt', 'délka šifrovaných dat');
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-CBC', false, ['encrypt', 'decrypt']);
  const padding = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: data.slice(-16) as BufferSource }, cryptoKey, new Uint8Array(0)));
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv as BufferSource }, cryptoKey, concat(data, padding) as BufferSource));
}

/** Klíč z hesla: H0 = hash(sůl + heslo UTF-16LE), Hn = hash(n + Hn-1), pak hash(H + blockKey) na délku klíče. */
async function passwordKeys(password: string, p: AgileInfo['password']) {
  const utf16 = new Uint8Array(password.length * 2);
  for (let i = 0; i < password.length; i++) {
    const c = password.charCodeAt(i);
    utf16[i * 2] = c & 0xff;
    utf16[i * 2 + 1] = c >>> 8;
  }
  let h: Uint8Array = await digest(p.hash, concat(p.salt, utf16));
  const buffer = new Uint8Array(4 + h.length);
  // SHA-512 (výchozí v Excelu) synchronně – 100 000 asynchronních volání WebCrypto by trvalo sekundy.
  for (let i = 0; i < p.spinCount; i++) {
    buffer.set(le32(i), 0);
    buffer.set(h, 4);
    h = p.hash === 'SHA-512' ? sha512(buffer) : await digest(p.hash, buffer);
  }
  const derive = async (block: readonly number[]) => fit(await digest(p.hash, concat(h, block)), p.keyBits / 8);
  return { verifierInput: await derive(BLOCK_VERIFIER_INPUT), verifierValue: await derive(BLOCK_VERIFIER_VALUE), keyValue: await derive(BLOCK_KEY_VALUE) };
}

/** Rozšifruje sešit Excelu chráněný heslem; vrátí běžný .xlsx (ZIP). Špatné heslo = OfficeCryptoError('wrongPassword'). */
export async function decryptOffice(buffer: ArrayBuffer, password: string): Promise<ArrayBuffer> {
  const streams = readCompoundStreams(buffer);
  const infoStream = streams.get('EncryptionInfo');
  const packageStream = streams.get('EncryptedPackage');
  if (!infoStream || !packageStream) throw new OfficeCryptoError('unsupported', 'chybí EncryptionInfo nebo EncryptedPackage');
  const info = parseEncryptionInfo(infoStream);
  const p = info.password;
  const keys = await passwordKeys(password, p);

  // Kontrola hesla: hash rozšifrovaného ověřovacího vstupu musí odpovídat rozšifrované ověřovací hodnotě.
  const input = (await aesCbcRaw(keys.verifierInput, p.salt, p.verifierInput)).slice(0, p.salt.length);
  const expected = await aesCbcRaw(keys.verifierValue, p.salt, p.verifierHash);
  const actual = await digest(p.hash, input);
  if (!actual.every((b, i) => b === expected[i])) throw new OfficeCryptoError('wrongPassword');

  const secretKey = (await aesCbcRaw(keys.keyValue, p.salt, p.keyValue)).slice(0, info.keyData.keyBits / 8);
  const size = Number(new DataView(packageStream.buffer, packageStream.byteOffset, 8).getBigUint64(0, true));
  const data = packageStream.subarray(8);
  const out = new Uint8Array(Math.ceil(data.length / 16) * 16);
  for (let block = 0, pos = 0; pos < data.length; block++, pos += SEGMENT) {
    const segment = data.subarray(pos, Math.min(pos + SEGMENT, data.length));
    const usable = segment.subarray(0, segment.length - (segment.length % 16));
    if (!usable.length) break;
    const iv = fit(await digest(info.keyData.hash, concat(info.keyData.salt, le32(block))), info.keyData.blockSize);
    out.set(await aesCbcRaw(secretKey, iv, usable), pos);
  }
  const result = out.slice(0, size);
  if (!isPlainXlsx(result.buffer)) throw new OfficeCryptoError('corrupt', 'rozšifrovaná data nejsou sešit');
  return result.buffer;
}
