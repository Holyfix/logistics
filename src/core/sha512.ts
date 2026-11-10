// SHA-512 (FIPS 180-4) synchronně v JavaScriptu. Odvození klíče z hesla v Office opakuje hash 100 000×;
// WebCrypto je asynchronní a jedno volání na opakování trvá sekundy, tady to jsou desítky milisekund.

const K = [
  '428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc', '3956c25bf348b538', '59f111f1b605d019', '923f82a4af194f9b', 'ab1c5ed5da6d8118',
  'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2', '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694',
  'e49b69c19ef14ad2', 'efbe4786384f25e3', '0fc19dc68b8cd5b5', '240ca1cc77ac9c65', '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5',
  '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4', 'c6e00bf33da88fc2', 'd5a79147930aa725', '06ca6351e003826f', '142929670a0e6e70',
  '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df', '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b',
  'a2bfe8a14cf10364', 'a81a664bbc423001', 'c24b8b70d0f89791', 'c76c51a30654be30', 'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8',
  '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8', '391c0cb3c5c95a63', '4ed8aa4ae3418acb', '5b9cca4f7763e373', '682e6ff3d6b2b8a3',
  '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec', '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b',
  'ca273eceea26619c', 'd186b8c721c0c207', 'eada7dd6cde0eb1e', 'f57d4f7fee6ed178', '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b',
  '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c', '4cc5d4becb3e42b6', '597f299cfc657e2a', '5fcb6fab3ad6faec', '6c44198c4a475817',
];
const KH = new Uint32Array(K.map((k) => parseInt(k.slice(0, 8), 16)));
const KL = new Uint32Array(K.map((k) => parseInt(k.slice(8), 16)));
const INIT = new Uint32Array(
  ['6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1', '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179'].flatMap((v) => [
    parseInt(v.slice(0, 8), 16),
    parseInt(v.slice(8), 16),
  ]),
);
// Pracovní pole se používají znovu (hash se volá 100 000× za sebou).
const h = new Uint32Array(16);
const wh = new Uint32Array(80);
const wl = new Uint32Array(80);

function add(i: number, xh: number, xl: number) {
  const lo = h[i * 2 + 1]! + xl;
  h[i * 2] = (h[i * 2]! + xh + (lo > 0xffffffff ? 1 : 0)) >>> 0;
  h[i * 2 + 1] = lo >>> 0;
}

/** SHA-512 bajtů. */
export function sha512(data: Uint8Array): Uint8Array {
  const bitLength = data.length * 8;
  const padded = new Uint8Array(Math.ceil((data.length + 17) / 128) * 128);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  h.set(INIT);

  for (let block = 0; block < padded.length; block += 128) {
    for (let i = 0; i < 16; i++) {
      wh[i] = view.getUint32(block + i * 8);
      wl[i] = view.getUint32(block + i * 8 + 4);
    }
    for (let i = 16; i < 80; i++) {
      // σ0 = rotr1 ^ rotr8 ^ shr7, σ1 = rotr19 ^ rotr61 ^ shr6
      let xh = wh[i - 15]!;
      let xl = wl[i - 15]!;
      const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
      const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
      xh = wh[i - 2]!;
      xl = wl[i - 2]!;
      const s1h = ((xh >>> 19) | (xl << 13)) ^ ((xl >>> 29) | (xh << 3)) ^ (xh >>> 6);
      const s1l = ((xl >>> 19) | (xh << 13)) ^ ((xh >>> 29) | (xl << 3)) ^ ((xl >>> 6) | (xh << 26));
      let lo = (s0l >>> 0) + (s1l >>> 0) + wl[i - 7]! + wl[i - 16]!;
      const hi = s0h + s1h + wh[i - 7]! + wh[i - 16]! + Math.floor(lo / 0x100000000);
      lo >>>= 0;
      wh[i] = hi >>> 0;
      wl[i] = lo;
    }
    let ah = h[0]!, al = h[1]!, bh = h[2]!, bl = h[3]!, ch = h[4]!, cl = h[5]!, dh = h[6]!, dl = h[7]!;
    let eh = h[8]!, el = h[9]!, fh = h[10]!, fl = h[11]!, gh = h[12]!, gl = h[13]!, hh = h[14]!, hl = h[15]!;
    for (let i = 0; i < 80; i++) {
      // Σ1(e) = rotr14 ^ rotr18 ^ rotr41, Ch(e,f,g), Σ0(a) = rotr28 ^ rotr34 ^ rotr39, Maj(a,b,c)
      const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
      const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
      const chh = (eh & fh) ^ (~eh & gh);
      const chl = (el & fl) ^ (~el & gl);
      let t1l = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + KL[i]! + wl[i]!;
      const t1h = (hh + S1h + chh + KH[i]! + wh[i]! + Math.floor(t1l / 0x100000000)) >>> 0;
      t1l >>>= 0;
      const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
      const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
      const majh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const majl = (al & bl) ^ (al & cl) ^ (bl & cl);
      let t2l = (S0l >>> 0) + (majl >>> 0);
      const t2h = (S0h + majh + Math.floor(t2l / 0x100000000)) >>> 0;
      t2l >>>= 0;
      hh = gh; hl = gl;
      gh = fh; gl = fl;
      fh = eh; fl = el;
      let nl = dl + t1l;
      eh = (dh + t1h + Math.floor(nl / 0x100000000)) >>> 0;
      el = nl >>> 0;
      dh = ch; dl = cl;
      ch = bh; cl = bl;
      bh = ah; bl = al;
      nl = t1l + t2l;
      ah = (t1h + t2h + Math.floor(nl / 0x100000000)) >>> 0;
      al = nl >>> 0;
    }
    add(0, ah, al);
    add(1, bh, bl);
    add(2, ch, cl);
    add(3, dh, dl);
    add(4, eh, el);
    add(5, fh, fl);
    add(6, gh, gl);
    add(7, hh, hl);
  }
  const out = new Uint8Array(64);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) outView.setUint32(i * 4, h[i]!);
  return out;
}
