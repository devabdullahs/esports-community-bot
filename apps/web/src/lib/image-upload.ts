function isBrand(bytes: Uint8Array, offset: number, brand: string): boolean {
  return (
    bytes[offset] === brand.charCodeAt(0) &&
    bytes[offset + 1] === brand.charCodeAt(1) &&
    bytes[offset + 2] === brand.charCodeAt(2) &&
    bytes[offset + 3] === brand.charCodeAt(3)
  );
}

function isAvifBrand(bytes: Uint8Array, offset: number): boolean {
  return isBrand(bytes, offset, "avif") || isBrand(bytes, offset, "avis");
}

export function matchesMagicBytes(bytes: Uint8Array, mimeType: string): boolean {
  if (bytes.length < 12) return false;
  switch (mimeType) {
    case "image/png":
      return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/gif":
      return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
    case "image/webp":
      return isBrand(bytes, 0, "RIFF") && isBrand(bytes, 8, "WEBP");
    case "image/avif": {
      if (!isBrand(bytes, 4, "ftyp")) return false;
      if (isAvifBrand(bytes, 8)) return true;
      if (bytes.length < 16) return false;
      const declaredBoxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
      const brandEnd = declaredBoxSize >= 16 && declaredBoxSize <= bytes.length ? declaredBoxSize : bytes.length;
      for (let offset = 16; offset + 3 < brandEnd; offset += 4) {
        if (isAvifBrand(bytes, offset)) return true;
      }
      return false;
    }
    default:
      return false;
  }
}
