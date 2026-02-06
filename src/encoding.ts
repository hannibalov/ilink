/**
 * iLink protocol encoding/decoding
 * Protocol format: 55aa [len] [cid] [data] [checksum]
 */

export function encodeILinkCommand(cid: string, data: string = ''): string {
  const header = '55aa';
  const dataBuf = Buffer.from(data, 'hex');
  const len = dataBuf.length;
  const cidHi = parseInt(cid.substring(0, 2), 16);
  const cidLo = parseInt(cid.substring(2, 4), 16);

  let sum = len + cidHi + cidLo;
  for (const b of dataBuf) sum += b;

  const checksum = (256 - (sum % 256)) % 256;
  const lenHex = len.toString(16).padStart(2, '0');
  const csHex = checksum.toString(16).padStart(2, '0');

  return `${header}${lenHex}${cid}${data}${csHex}`;
}

export function parseILinkStatus(hex: string): Partial<{ power: boolean; brightness: number; color: { r: number; g: number; b: number } }> {
  if (!hex.startsWith('55aa')) {
    return {};
  }

  const cid = hex.substring(6, 10);
  const data = hex.substring(10, hex.length - 2);
  const len = parseInt(hex.substring(4, 6), 16);

  // Status response with RGB and brightness
  if (cid === '8815' || cid === '8814') {
    if (data.length < 8) {
      return {};
    }

    const r = parseInt(data.substring(0, 2), 16);
    const g = parseInt(data.substring(2, 4), 16);
    const b = parseInt(data.substring(4, 6), 16);
    const brightnessRaw = parseInt(data.substring(6, 8), 16);
    const brightness = Math.floor(brightnessRaw / 2.55);

    return {
      power: true,
      brightness: brightness || 100,
      color: { r, g, b }
    };
  }

  // Power status
  if (cid === '0805') {
    return { power: data === '01' };
  }

  // Brightness status
  if (cid === '0801') {
    return { power: true, brightness: Math.floor(parseInt(data, 16) / 2.55) };
  }

  // Color status
  if (cid === '0802') {
    return {
      power: true,
      color: {
        r: parseInt(data.substring(0, 2), 16),
        g: parseInt(data.substring(2, 4), 16),
        b: parseInt(data.substring(4, 6), 16)
      }
    };
  }

  return {};
}
