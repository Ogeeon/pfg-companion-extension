// Generates the placeholder store icons (a battery glyph in the panel's colours) without any
// dependencies: a hand-rolled PNG writer on top of node:zlib. Replace icons/icon-48.png and
// icons/icon-128.png with real artwork before publishing to the stores.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BACKGROUND = [0x10, 0x19, 0x26, 0xff];
const BORDER = [0x98, 0xb5, 0xd0, 0xff];
const FILL = [0x70, 0xb7, 0xe8, 0xff];

/** @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r */
function roundedRect(x, y, w, h, r) {
  return (px, py) => {
    if (px < x || px > x + w || py < y || py > y + h) return false;
    const dx = Math.max(x + r - px, px - (x + w - r), 0);
    const dy = Math.max(y + r - py, py - (y + h - r), 0);
    return dx * dx + dy * dy <= r * r;
  };
}

/** @param {number} x @param {number} y @param {number} w @param {number} h */
function rect(x, y, w, h) {
  return (px, py) => px >= x && px <= x + w && py >= y && py <= y + h;
}

// All shapes are described on a 128x128 grid and scaled to the target size.
const SHAPES = [
  [roundedRect(0, 0, 128, 128, 26), BACKGROUND],
  [rect(30, 46, 60, 36), BORDER], // the battery body
  [rect(90, 56, 8, 16), BORDER], // the nub
  [rect(35, 51, 50, 26), FILL], // a full battery (level 3)
];

/** @param {number} size */
function draw(size) {
  const scale = size / 128;
  const data = Buffer.alloc(size * size * 4, 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;
      for (const [contains, color] of SHAPES) {
        if (contains(px, py)) {
          data.set(color, (y * size + x) * 4);
          break;
        }
      }
    }
  }
  return data;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** @param {Buffer} buf */
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

/** @param {number} size @param {Buffer} rgba */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const icons = path.join(__dirname, '..', 'icons');
fs.mkdirSync(icons, { recursive: true });
for (const size of [48, 128]) {
  fs.writeFileSync(path.join(icons, `icon-${size}.png`), encodePng(size, draw(size)));
  console.log(`icons/icon-${size}.png written`);
}
