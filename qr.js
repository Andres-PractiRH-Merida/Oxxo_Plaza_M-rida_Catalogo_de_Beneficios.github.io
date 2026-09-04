// Codificador QR autocontenido (modo byte, corrección L, versiones 1-10).
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;

function genPoly(n) {
  let p = [1];
  for (let i = 0; i < n; i++) {
    const q = [1, EXP[i]], r = new Array(p.length + 1).fill(0);
    for (let a = 0; a < p.length; a++) for (let b = 0; b < 2; b++) r[a + b] ^= mul(p[a], q[b]);
    p = r;
  }
  return p;
}
function eccOf(data, n) {
  const g = genPoly(n), res = new Array(data.length + n).fill(0);
  for (let i = 0; i < data.length; i++) res[i] = data[i];
  for (let i = 0; i < data.length; i++) {
    const c = res[i]; if (!c) continue;
    for (let j = 0; j < g.length; j++) res[i + j] ^= mul(g[j], c);
  }
  return res.slice(data.length);
}

const BLOCKS = { 1: [[1, 19]], 2: [[1, 34]], 3: [[1, 55]], 4: [[1, 80]], 5: [[1, 108]], 6: [[2, 68]], 7: [[2, 78]], 8: [[2, 97]], 9: [[2, 116]], 10: [[2, 68], [2, 69]] };
const ECW = { 1: 7, 2: 10, 3: 15, 4: 20, 5: 26, 6: 18, 7: 20, 8: 24, 9: 30, 10: 18 };
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

const dataCap = (v) => BLOCKS[v].reduce((s, [c, d]) => s + c * d, 0);
const bchDigit = (d) => { let n = 0; while (d !== 0) { n++; d >>>= 1; } return n; };
function bch(data, poly) {
  let d = data << (bchDigit(poly) - 1);
  while (bchDigit(d) - bchDigit(poly) >= 0) d ^= poly << (bchDigit(d) - bchDigit(poly));
  return (data << (bchDigit(poly) - 1)) | d;
}

export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  let v = 0;
  for (let i = 1; i <= 10; i++) {
    const lenBits = i < 10 ? 8 : 16;
    if (bytes.length + Math.ceil((4 + lenBits) / 8) <= dataCap(i)) { v = i; break; }
  }
  if (!v) throw new Error("texto demasiado largo para QR v10");

  const lenBits = v < 10 ? 8 : 16;
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(4, 4); push(bytes.length, lenBits);
  for (const b of bytes) push(b, 8);
  const cap = dataCap(v) * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const words = [];
  for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  const pads = [0xec, 0x11];
  while (words.length < dataCap(v)) words.push(pads[(words.length - bits.length / 8) % 2]);

  // bloques + corrección
  const blocks = [];
  let off = 0;
  for (const [count, dw] of BLOCKS[v]) for (let i = 0; i < count; i++) {
    const d = words.slice(off, off + dw); off += dw;
    blocks.push({ d, e: eccOf(d, ECW[v]) });
  }
  const inter = [];
  const maxD = Math.max(...blocks.map(b => b.d.length));
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) inter.push(b.d[i]);
  for (let i = 0; i < ECW[v]; i++) for (const b of blocks) inter.push(b.e[i]);

  // módulos
  const size = v * 4 + 17;
  const mat = Array.from({ length: size }, () => new Array(size).fill(null));
  const finder = (r, c) => {
    for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
      const rr = r + i, cc = c + j;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) || (j >= 0 && j <= 6 && (i === 0 || i === 6)) || (i >= 2 && i <= 4 && j >= 2 && j <= 4);
      mat[rr][cc] = on;
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (const a of ALIGN[v]) for (const b of ALIGN[v]) {
    if (mat[a][b] !== null) continue;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++)
      mat[a + i][b + j] = Math.max(Math.abs(i), Math.abs(j)) !== 1;
  }
  for (let i = 8; i < size - 8; i++) { if (mat[6][i] === null) mat[6][i] = i % 2 === 0; if (mat[i][6] === null) mat[i][6] = i % 2 === 0; }

  const fmt = bch(8, 0x537) ^ 0x5412; // nivel L, máscara 0
  for (let i = 0; i < 15; i++) {
    const on = ((fmt >> i) & 1) === 1;
    if (i < 6) mat[i][8] = on; else if (i < 8) mat[i + 1][8] = on; else mat[size - 15 + i][8] = on;
    if (i < 8) mat[8][size - i - 1] = on; else if (i < 9) mat[8][15 - i] = on; else mat[8][14 - i] = on;
  }
  mat[size - 8][8] = true;
  if (v >= 7) {
    const vi = bch(v, 0x1f25);
    for (let i = 0; i < 18; i++) {
      const on = ((vi >> i) & 1) === 1;
      mat[Math.floor(i / 3)][i % 3 + size - 11] = on;
      mat[i % 3 + size - 11][Math.floor(i / 3)] = on;
    }
  }

  let inc = -1, row = size - 1, bit = 7, byte = 0;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        if (mat[row][col - c] !== null) continue;
        let dark = byte < inter.length ? ((inter[byte] >>> bit) & 1) === 1 : false;
        if ((row + col - c) % 2 === 0) dark = !dark;
        mat[row][col - c] = dark;
        if (--bit === -1) { byte++; bit = 7; }
      }
      row += inc;
      if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
    }
  }
  return mat;
}

export function drawQRCanvas(canvas, text, px, dark = "#201e1d", light = "#ffffff") {
  const m = qrMatrix(text), n = m.length;
  const scale = Math.max(1, Math.floor(px / n));
  const s = scale * n;
  canvas.width = s; canvas.height = s;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = light; ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = dark;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) ctx.fillRect(c * scale, r * scale, scale, scale);
}
