import {
  WATERMARK_TEXT_MAX_LENGTH,
  type AppSettings,
  type HiddenWatermarkSettings,
  type VisibleWatermarkSettings,
} from "./settings";

export type DecodedHiddenWatermark = {
  text: string;
  createdAt: string | null;
  version: number;
};

const ROBUST_WATERMARK_MAGIC = "XSWM2";
const ROBUST_WATERMARK_VERSION = 2;
const ROBUST_MAX_BODY_BYTES = 1024;
const ROBUST_BLOCK_SIZE = 8;
const ROBUST_HEADER_BLOCK_RATIO = 0.18;
const ROBUST_MAX_HEADER_REPEATS = 15;
const ROBUST_MAX_BODY_REPEATS = 9;
const ROBUST_COEFF_A = [3, 2] as const;
const ROBUST_COEFF_B = [2, 3] as const;
const ROBUST_MARGIN = 18;
const ROBUST_MAX_COEFF_DELTA = 46;
const LEGACY_WATERMARK_MAGIC = "XSHOTWM1";
const LEGACY_WATERMARK_VERSION = 1;
const LEGACY_MAX_PAYLOAD_BYTES = 2048;
const WATERMARK_FONT_FAMILY = "Inter, Arial, sans-serif";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type LegacyHiddenWatermarkEnvelope = {
  version: number;
  text: string;
  createdAt: string;
};

const ROBUST_MAGIC_BYTES = textEncoder.encode(ROBUST_WATERMARK_MAGIC);
const ROBUST_HEADER_BYTES = ROBUST_MAGIC_BYTES.length + 2 + 4;
const ROBUST_HEADER_BITS = ROBUST_HEADER_BYTES * 8;
const DCT_BASIS_CACHE = new Map<string, Float64Array>();

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(text: string) {
  return text.trim().slice(0, WATERMARK_TEXT_MAX_LENGTH);
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob((blob) => resolve(blob), "image/png")
  );
}

async function imageFromBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();

  try {
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawVisibleWatermark(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: VisibleWatermarkSettings
) {
  const text = normalizeText(settings.text);
  if (!settings.enabled || !text) return false;

  const shortestSide = Math.min(width, height);
  const fontSize = clamp(Math.round(shortestSide / 18), 18, 44);
  const opacity = clamp(settings.opacity, 0.08, 0.35);

  context.save();
  context.font = `700 ${fontSize}px ${WATERMARK_FONT_FAMILY}`;
  context.fillStyle = `rgba(17, 31, 45, ${opacity})`;
  context.textBaseline = "middle";
  context.letterSpacing = "0px";

  if (
    settings.placement === "repeat-diagonal" ||
    settings.placement === "repeat-horizontal"
  ) {
    const metrics = context.measureText(text);
    const spacingX = Math.max(220, metrics.width + 120);
    const spacingY = Math.max(120, fontSize * 4);
    const angle = settings.placement === "repeat-diagonal" ? -Math.PI / 6 : 0;
    const rangeX = width + height;
    const rangeY = height + width;

    context.translate(width / 2, height / 2);
    context.rotate(angle);
    context.textAlign = "center";

    for (let y = -rangeY; y <= rangeY; y += spacingY) {
      for (let x = -rangeX; x <= rangeX; x += spacingX) {
        context.fillText(text, x, y);
      }
    }
  } else {
    const margin = Math.max(18, fontSize * 0.9);
    const isRight = settings.placement.endsWith("right");
    const isBottom = settings.placement.startsWith("bottom");
    context.textAlign = isRight ? "right" : "left";
    context.fillText(
      text,
      isRight ? width - margin : margin,
      isBottom ? height - margin : margin
    );
  }

  context.restore();
  return true;
}

function u16ToBytes(value: number) {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

function bytesToU16(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 8) | bytes[offset + 1]) >>> 0;
}

function u32ToBytes(value: number) {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function bytesToU32(bytes: Uint8Array, offset: number) {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function fnv1a(bytes: Uint8Array) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function concatBytes(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function bytesToBits(bytes: Uint8Array) {
  const bits = new Uint8Array(bytes.length * 8);

  for (let bitIndex = 0; bitIndex < bits.length; bitIndex += 1) {
    const byte = bytes[bitIndex >> 3];
    bits[bitIndex] = (byte >> (7 - (bitIndex % 8))) & 1;
  }

  return bits;
}

function bitsToBytes(bits: Uint8Array) {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));

  for (let bitIndex = 0; bitIndex < bits.length; bitIndex += 1) {
    bytes[bitIndex >> 3] |= bits[bitIndex] << (7 - (bitIndex % 8));
  }

  return bytes;
}

function createPrng(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function getDctBasis(u: number, v: number) {
  const key = `${u}:${v}`;
  const cached = DCT_BASIS_CACHE.get(key);
  if (cached) return cached;

  const basis = new Float64Array(ROBUST_BLOCK_SIZE * ROBUST_BLOCK_SIZE);
  const alphaU = u === 0 ? Math.SQRT1_2 : 1;
  const alphaV = v === 0 ? Math.SQRT1_2 : 1;
  const scale = 0.25 * alphaU * alphaV;

  for (let y = 0; y < ROBUST_BLOCK_SIZE; y += 1) {
    for (let x = 0; x < ROBUST_BLOCK_SIZE; x += 1) {
      basis[y * ROBUST_BLOCK_SIZE + x] =
        scale *
        Math.cos(((2 * x + 1) * u * Math.PI) / 16) *
        Math.cos(((2 * y + 1) * v * Math.PI) / 16);
    }
  }

  DCT_BASIS_CACHE.set(key, basis);
  return basis;
}

function getRobustBlockLayout(imageData: ImageData) {
  const blocksX = Math.floor(imageData.width / ROBUST_BLOCK_SIZE);
  const blocksY = Math.floor(imageData.height / ROBUST_BLOCK_SIZE);
  const blockCount = blocksX * blocksY;

  return { blocksX, blocksY, blockCount };
}

function makeRobustBlockOrder(blocksX: number, blocksY: number) {
  const blockCount = blocksX * blocksY;
  const order = new Uint32Array(blockCount);

  for (let index = 0; index < blockCount; index += 1) {
    order[index] = index;
  }

  const seed = fnv1a(
    textEncoder.encode(`xshot-watermark-v2:${blocksX}:${blocksY}`)
  );
  const random = createPrng(seed);

  for (let index = blockCount - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const value = order[index];
    order[index] = order[swapIndex];
    order[swapIndex] = value;
  }

  return order;
}

function getRobustHeaderRepeat(blockCount: number) {
  return Math.max(
    1,
    Math.min(
      ROBUST_MAX_HEADER_REPEATS,
      Math.floor((blockCount * ROBUST_HEADER_BLOCK_RATIO) / ROBUST_HEADER_BITS)
    )
  );
}

function chooseRobustHeaderRepeat(blockCount: number, bodyBitCount: number) {
  let repeat = getRobustHeaderRepeat(blockCount);

  while (
    repeat > 1 &&
    repeat * ROBUST_HEADER_BITS + bodyBitCount > blockCount
  ) {
    repeat -= 1;
  }

  return repeat * ROBUST_HEADER_BITS + bodyBitCount <= blockCount ? repeat : 0;
}

function getBlockTopLeft(
  blockIndex: number,
  blocksX: number
): { left: number; top: number } {
  return {
    left: (blockIndex % blocksX) * ROBUST_BLOCK_SIZE,
    top: Math.floor(blockIndex / blocksX) * ROBUST_BLOCK_SIZE,
  };
}

function getPixelLuma(data: Uint8ClampedArray, dataIndex: number) {
  return (
    data[dataIndex] * 0.299 +
    data[dataIndex + 1] * 0.587 +
    data[dataIndex + 2] * 0.114 -
    128
  );
}

function readDctCoefficient(
  imageData: ImageData,
  blockIndex: number,
  blocksX: number,
  basis: Float64Array
) {
  const { left, top } = getBlockTopLeft(blockIndex, blocksX);
  let coefficient = 0;

  for (let y = 0; y < ROBUST_BLOCK_SIZE; y += 1) {
    for (let x = 0; x < ROBUST_BLOCK_SIZE; x += 1) {
      const dataIndex = ((top + y) * imageData.width + left + x) * 4;
      coefficient +=
        getPixelLuma(imageData.data, dataIndex) *
        basis[y * ROBUST_BLOCK_SIZE + x];
    }
  }

  return coefficient;
}

function adjustBlockCoefficientPair(
  imageData: ImageData,
  blockIndex: number,
  blocksX: number,
  bit: number,
  basisA: Float64Array,
  basisB: Float64Array
) {
  const coefficientA = readDctCoefficient(
    imageData,
    blockIndex,
    blocksX,
    basisA
  );
  const coefficientB = readDctCoefficient(
    imageData,
    blockIndex,
    blocksX,
    basisB
  );
  const diff = coefficientA - coefficientB;
  const targetDiff = bit === 1 ? ROBUST_MARGIN : -ROBUST_MARGIN;
  const delta = clamp(
    targetDiff - diff,
    -ROBUST_MAX_COEFF_DELTA,
    ROBUST_MAX_COEFF_DELTA
  );

  if (Math.abs(delta) < 0.01) return;

  const { left, top } = getBlockTopLeft(blockIndex, blocksX);
  const halfDelta = delta / 2;

  for (let y = 0; y < ROBUST_BLOCK_SIZE; y += 1) {
    for (let x = 0; x < ROBUST_BLOCK_SIZE; x += 1) {
      const basisIndex = y * ROBUST_BLOCK_SIZE + x;
      const adjustment =
        halfDelta * basisA[basisIndex] - halfDelta * basisB[basisIndex];
      const dataIndex = ((top + y) * imageData.width + left + x) * 4;

      imageData.data[dataIndex] = clamp(
        imageData.data[dataIndex] + adjustment,
        0,
        255
      );
      imageData.data[dataIndex + 1] = clamp(
        imageData.data[dataIndex + 1] + adjustment,
        0,
        255
      );
      imageData.data[dataIndex + 2] = clamp(
        imageData.data[dataIndex + 2] + adjustment,
        0,
        255
      );
    }
  }
}

function readRobustBit(
  imageData: ImageData,
  blockIndex: number,
  blocksX: number,
  basisA: Float64Array,
  basisB: Float64Array
) {
  return readDctCoefficient(imageData, blockIndex, blocksX, basisA) >
    readDctCoefficient(imageData, blockIndex, blocksX, basisB)
    ? 1
    : 0;
}

function encodeRobustBits(
  imageData: ImageData,
  order: Uint32Array,
  blocksX: number,
  startOffset: number,
  bits: Uint8Array,
  repeat: number
) {
  const basisA = getDctBasis(ROBUST_COEFF_A[0], ROBUST_COEFF_A[1]);
  const basisB = getDctBasis(ROBUST_COEFF_B[0], ROBUST_COEFF_B[1]);

  for (let bitIndex = 0; bitIndex < bits.length; bitIndex += 1) {
    for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex += 1) {
      const orderIndex = startOffset + bitIndex * repeat + repeatIndex;
      adjustBlockCoefficientPair(
        imageData,
        order[orderIndex],
        blocksX,
        bits[bitIndex],
        basisA,
        basisB
      );
    }
  }
}

function decodeRobustBits(
  imageData: ImageData,
  order: Uint32Array,
  blocksX: number,
  startOffset: number,
  bitCount: number,
  repeat: number
) {
  const bits = new Uint8Array(bitCount);
  const basisA = getDctBasis(ROBUST_COEFF_A[0], ROBUST_COEFF_A[1]);
  const basisB = getDctBasis(ROBUST_COEFF_B[0], ROBUST_COEFF_B[1]);

  for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
    let oneVotes = 0;

    for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex += 1) {
      const orderIndex = startOffset + bitIndex * repeat + repeatIndex;
      oneVotes += readRobustBit(
        imageData,
        order[orderIndex],
        blocksX,
        basisA,
        basisB
      );
    }

    bits[bitIndex] = oneVotes > repeat / 2 ? 1 : 0;
  }

  return bitsToBytes(bits);
}

function encodeRobustWatermarkPacket(settings: HiddenWatermarkSettings) {
  const text = normalizeText(settings.text);
  if (!settings.enabled || !text) return null;

  const textBytes = textEncoder.encode(text);
  const body = concatBytes([
    new Uint8Array([ROBUST_WATERMARK_VERSION]),
    u32ToBytes(Math.floor(Date.now() / 1000)),
    u16ToBytes(textBytes.length),
    textBytes,
  ]);

  if (body.length > ROBUST_MAX_BODY_BYTES) return null;

  const header = concatBytes([
    ROBUST_MAGIC_BYTES,
    u16ToBytes(body.length),
    u32ToBytes(fnv1a(body)),
  ]);

  return { header, body };
}

function parseRobustWatermarkBody(body: Uint8Array) {
  if (body.length < 7 || body[0] !== ROBUST_WATERMARK_VERSION) return null;

  const createdAtSeconds = bytesToU32(body, 1);
  const textLength = bytesToU16(body, 5);
  if (textLength === 0 || 7 + textLength > body.length) return null;

  const text = textDecoder.decode(body.slice(7, 7 + textLength));
  if (!text.trim()) return null;

  return {
    text: text.slice(0, WATERMARK_TEXT_MAX_LENGTH),
    createdAt: new Date(createdAtSeconds * 1000).toISOString(),
    version: ROBUST_WATERMARK_VERSION,
  };
}

function writeRobustHiddenWatermark(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: HiddenWatermarkSettings
) {
  const packet = encodeRobustWatermarkPacket(settings);
  if (!packet) return false;

  const imageData = context.getImageData(0, 0, width, height);
  const { blocksX, blocksY, blockCount } = getRobustBlockLayout(imageData);
  if (blockCount <= ROBUST_HEADER_BITS) return false;

  const headerBits = bytesToBits(packet.header);
  const bodyBits = bytesToBits(packet.body);
  const headerRepeat = chooseRobustHeaderRepeat(blockCount, bodyBits.length);
  if (headerRepeat < 1) return false;

  const headerBlockCount = headerBits.length * headerRepeat;
  const bodyRepeat = Math.min(
    ROBUST_MAX_BODY_REPEATS,
    Math.floor((blockCount - headerBlockCount) / bodyBits.length)
  );
  if (bodyRepeat < 1) return false;

  const order = makeRobustBlockOrder(blocksX, blocksY);
  encodeRobustBits(imageData, order, blocksX, 0, headerBits, headerRepeat);
  encodeRobustBits(
    imageData,
    order,
    blocksX,
    headerBlockCount,
    bodyBits,
    bodyRepeat
  );

  context.putImageData(imageData, 0, 0);
  return true;
}

function decodeRobustHiddenWatermarkFromCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return null;

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { blocksX, blocksY, blockCount } = getRobustBlockLayout(imageData);
  if (blockCount <= ROBUST_HEADER_BITS) return null;

  const order = makeRobustBlockOrder(blocksX, blocksY);
  const maxHeaderRepeat = getRobustHeaderRepeat(blockCount);

  for (
    let headerRepeat = maxHeaderRepeat;
    headerRepeat >= 1;
    headerRepeat -= 1
  ) {
    const header = decodeRobustBits(
      imageData,
      order,
      blocksX,
      0,
      ROBUST_HEADER_BITS,
      headerRepeat
    );
    const magic = textDecoder.decode(
      header.slice(0, ROBUST_MAGIC_BYTES.length)
    );
    if (magic !== ROBUST_WATERMARK_MAGIC) continue;

    const bodyLength = bytesToU16(header, ROBUST_MAGIC_BYTES.length);
    if (bodyLength <= 0 || bodyLength > ROBUST_MAX_BODY_BYTES) continue;

    const checksum = bytesToU32(header, ROBUST_MAGIC_BYTES.length + 2);
    const bodyBitCount = bodyLength * 8;
    const headerBlockCount = ROBUST_HEADER_BITS * headerRepeat;
    const bodyRepeat = Math.min(
      ROBUST_MAX_BODY_REPEATS,
      Math.floor((blockCount - headerBlockCount) / bodyBitCount)
    );
    if (bodyRepeat < 1) continue;

    const body = decodeRobustBits(
      imageData,
      order,
      blocksX,
      headerBlockCount,
      bodyBitCount,
      bodyRepeat
    );
    if (fnv1a(body) !== checksum) continue;

    const decoded = parseRobustWatermarkBody(body);
    if (decoded) return decoded;
  }

  return null;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);

  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }

  return x;
}

function createLegacyPixelSequence(width: number, height: number) {
  const total = Math.max(1, width * height);
  const seed =
    (Math.imul(width, 73856093) ^ Math.imul(height, 19349663) ^ 0x9e3779b9) >>>
      0 || 1;
  const start = seed % total;
  let step = (seed % Math.max(1, total - 1)) | 1;

  while (gcd(step, total) !== 1) {
    step += 2;
    if (step >= total) step = (step % total) | 1;
  }

  return { start, step, total };
}

function writeLegacyBytesToImageData(
  imageData: ImageData,
  bytes: Uint8Array
): boolean {
  const bitCount = bytes.length * 8;
  const sequence = createLegacyPixelSequence(imageData.width, imageData.height);

  if (bitCount > sequence.total) return false;

  for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
    const byte = bytes[bitIndex >> 3];
    const bit = (byte >> (7 - (bitIndex % 8))) & 1;
    const pixelIndex =
      (sequence.start + bitIndex * sequence.step) % sequence.total;
    const dataIndex = pixelIndex * 4 + 2;
    imageData.data[dataIndex] = (imageData.data[dataIndex] & 0xfe) | bit;
  }

  return true;
}

function readLegacyBytesFromImageData(imageData: ImageData, byteCount: number) {
  const bitCount = byteCount * 8;
  const sequence = createLegacyPixelSequence(imageData.width, imageData.height);

  if (bitCount > sequence.total) return null;

  const bytes = new Uint8Array(byteCount);
  for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
    const pixelIndex =
      (sequence.start + bitIndex * sequence.step) % sequence.total;
    const dataIndex = pixelIndex * 4 + 2;
    const bit = imageData.data[dataIndex] & 1;
    bytes[bitIndex >> 3] |= bit << (7 - (bitIndex % 8));
  }

  return bytes;
}

function encodeLegacyHiddenWatermarkBytes(settings: HiddenWatermarkSettings) {
  const text = normalizeText(settings.text);
  if (!settings.enabled || !text) return null;

  const payload: LegacyHiddenWatermarkEnvelope = {
    version: LEGACY_WATERMARK_VERSION,
    text,
    createdAt: new Date().toISOString(),
  };
  const payloadBytes = textEncoder.encode(JSON.stringify(payload));
  if (payloadBytes.length > LEGACY_MAX_PAYLOAD_BYTES) return null;

  return concatBytes([
    textEncoder.encode(LEGACY_WATERMARK_MAGIC),
    u32ToBytes(payloadBytes.length),
    u32ToBytes(fnv1a(payloadBytes)),
    payloadBytes,
  ]);
}

function writeLegacyHiddenWatermark(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: HiddenWatermarkSettings
) {
  const bytes = encodeLegacyHiddenWatermarkBytes(settings);
  if (!bytes) return false;

  const imageData = context.getImageData(0, 0, width, height);
  if (!writeLegacyBytesToImageData(imageData, bytes)) return false;

  context.putImageData(imageData, 0, 0);
  return true;
}

function decodeLegacyHiddenWatermarkFromCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return null;

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const magicBytes = textEncoder.encode(LEGACY_WATERMARK_MAGIC);
  const headerSize = magicBytes.length + 8;
  const headerBytes = readLegacyBytesFromImageData(imageData, headerSize);
  if (!headerBytes) return null;

  const magic = textDecoder.decode(headerBytes.slice(0, magicBytes.length));
  if (magic !== LEGACY_WATERMARK_MAGIC) return null;

  const payloadLength = bytesToU32(headerBytes, magicBytes.length);
  const checksum = bytesToU32(headerBytes, magicBytes.length + 4);
  if (payloadLength === 0 || payloadLength > LEGACY_MAX_PAYLOAD_BYTES) {
    return null;
  }

  const totalSize = headerSize + payloadLength;
  if (totalSize * 8 > imageData.width * imageData.height) return null;

  const allBytes = readLegacyBytesFromImageData(imageData, totalSize);
  if (!allBytes) return null;

  const payloadBytes = allBytes.slice(headerSize);
  if (fnv1a(payloadBytes) !== checksum) return null;

  try {
    const decoded = JSON.parse(
      textDecoder.decode(payloadBytes)
    ) as Partial<LegacyHiddenWatermarkEnvelope>;
    if (typeof decoded.text !== "string" || !decoded.text.trim()) {
      return null;
    }

    return {
      text: decoded.text.slice(0, WATERMARK_TEXT_MAX_LENGTH),
      createdAt:
        typeof decoded.createdAt === "string" ? decoded.createdAt : null,
      version:
        typeof decoded.version === "number"
          ? decoded.version
          : LEGACY_WATERMARK_VERSION,
    };
  } catch {
    return null;
  }
}

function writeHiddenWatermark(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: HiddenWatermarkSettings
) {
  const robustWritten = writeRobustHiddenWatermark(
    context,
    width,
    height,
    settings
  );
  const legacyWritten = writeLegacyHiddenWatermark(
    context,
    width,
    height,
    settings
  );

  return robustWritten || legacyWritten;
}

function decodeHiddenWatermarkFromCanvas(canvas: HTMLCanvasElement) {
  return (
    decodeRobustHiddenWatermarkFromCanvas(canvas) ||
    decodeLegacyHiddenWatermarkFromCanvas(canvas)
  );
}

export async function applyWatermarksToBlob(blob: Blob, settings: AppSettings) {
  const hasVisibleWatermark =
    settings.visibleWatermark.enabled &&
    Boolean(normalizeText(settings.visibleWatermark.text));
  const hasHiddenWatermark =
    settings.hiddenWatermark.enabled &&
    Boolean(normalizeText(settings.hiddenWatermark.text));

  if (!hasVisibleWatermark && !hasHiddenWatermark) return blob;

  const image = await imageFromBlob(blob);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) return blob;

  context.drawImage(image, 0, 0, width, height);
  drawVisibleWatermark(context, width, height, settings.visibleWatermark);
  writeHiddenWatermark(context, width, height, settings.hiddenWatermark);

  return (await canvasToPngBlob(canvas)) || blob;
}

export async function decodeHiddenWatermarkFromBlob(blob: Blob) {
  const image = await imageFromBlob(blob);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.drawImage(image, 0, 0, width, height);
  return decodeHiddenWatermarkFromCanvas(canvas);
}

export function decodeHiddenWatermarkFromFile(file: File) {
  return decodeHiddenWatermarkFromBlob(file);
}
