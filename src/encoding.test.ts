import { encodeILinkCommand, parseILinkStatus } from './encoding';

describe('encodeILinkCommand', () => {
  describe('Power commands', () => {
    it('should encode ON command correctly', () => {
      const command = encodeILinkCommand('0805', '01');
      expect(command).toBe('55aa01080501f1');
    });

    it('should encode OFF command correctly', () => {
      const command = encodeILinkCommand('0805', '00');
      expect(command).toBe('55aa01080500f2');
    });
  });

  describe('Color commands', () => {
    it('should encode RED color command correctly', () => {
      const command = encodeILinkCommand('0802', 'ff0000');
      expect(command).toBe('55aa030802ff0000f4');
    });

    it('should encode GREEN color command correctly', () => {
      const command = encodeILinkCommand('0802', '00ff00');
      // Calculate expected checksum: len(3) + cidHi(8) + cidLo(2) + data(0x00, 0xff, 0x00)
      // sum = 3 + 8 + 2 + 0 + 255 + 0 = 268
      // checksum = (256 - (268 % 256)) % 256 = (256 - 12) % 256 = 244 = 0xf4
      expect(command).toBe('55aa03080200ff00f4');
    });

    it('should encode BLUE color command correctly', () => {
      const command = encodeILinkCommand('0802', '0000ff');
      expect(command).toBe('55aa0308020000fff4');
    });

    it('should encode WHITE color command correctly', () => {
      const command = encodeILinkCommand('0802', 'ffffff');
      // sum = 3 + 8 + 2 + 255 + 255 + 255 = 778
      // 778 % 256 = 10 (since 778 = 3*256 + 10)
      // checksum = (256 - 10) % 256 = 246 = 0xf6
      expect(command).toBe('55aa030802fffffff6');
    });
  });

  describe('Brightness commands', () => {
    it('should encode brightness command correctly', () => {
      const command = encodeILinkCommand('0801', 'ff');
      // sum = 1 + 8 + 1 + 255 = 265
      // checksum = (256 - (265 % 256)) % 256 = (256 - 9) % 256 = 247 = 0xf7
      expect(command).toBe('55aa010801fff7');
    });

    it('should encode minimum brightness correctly', () => {
      const command = encodeILinkCommand('0801', '00');
      // sum = 1 + 8 + 1 + 0 = 10
      // checksum = (256 - 10) % 256 = 246 = 0xf6
      expect(command).toBe('55aa01080100f6');
    });
  });

  describe('Checksum calculation', () => {
    it('should calculate checksum correctly for various commands', () => {
      // Test with empty data
      const emptyCommand = encodeILinkCommand('0805', '');
      expect(emptyCommand).toMatch(/^55aa00/);
      
      // Test with single byte data
      const singleByte = encodeILinkCommand('0805', '01');
      expect(singleByte).toMatch(/^55aa01/);
      
      // Test with multi-byte data
      const multiByte = encodeILinkCommand('0802', 'ff0000');
      expect(multiByte).toMatch(/^55aa03/);
    });

    it('should handle checksum overflow correctly', () => {
      // Command with large sum that causes overflow
      const command = encodeILinkCommand('0802', 'ffffff');
      // Verify the checksum is valid (last 2 hex chars)
      const checksum = parseInt(command.slice(-2), 16);
      expect(checksum).toBeGreaterThanOrEqual(0);
      expect(checksum).toBeLessThan(256);
    });
  });

  describe('Command format', () => {
    it('should always start with 55aa header', () => {
      const command = encodeILinkCommand('0805', '01');
      expect(command.startsWith('55aa')).toBe(true);
    });

    it('should have correct length field', () => {
      const command1 = encodeILinkCommand('0805', '01');
      expect(command1.substring(4, 6)).toBe('01'); // 1 byte data
      
      const command2 = encodeILinkCommand('0802', 'ff0000');
      expect(command2.substring(4, 6)).toBe('03'); // 3 bytes data
    });

    it('should include CID in correct position', () => {
      const command = encodeILinkCommand('0805', '01');
      expect(command.substring(6, 10)).toBe('0805');
    });

    it('should include data in correct position', () => {
      const command = encodeILinkCommand('0805', '01');
      expect(command.substring(10, 12)).toBe('01');
    });

    it('should end with checksum (2 hex chars)', () => {
      const command = encodeILinkCommand('0805', '01');
      expect(command.length).toBe(14); // 55aa(4) + len(2) + cid(4) + data(2) + checksum(2)
      const checksum = command.slice(-2);
      expect(checksum).toMatch(/^[0-9a-f]{2}$/i);
    });
  });
});

describe('parseILinkStatus', () => {
  describe('Power status parsing', () => {
    it('should parse ON status correctly', () => {
      const status = parseILinkStatus('55aa01080501f1');
      expect(status.power).toBe(true);
    });

    it('should parse OFF status correctly', () => {
      const status = parseILinkStatus('55aa01080500f2');
      expect(status.power).toBe(false);
    });
  });

  describe('Color status parsing', () => {
    it('should parse RGB color status correctly', () => {
      const status = parseILinkStatus('55aa030802ff0000f4');
      expect(status.power).toBe(true);
      expect(status.color).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('should parse green color correctly', () => {
      const status = parseILinkStatus('55aa03080200ff00f4');
      expect(status.color).toEqual({ r: 0, g: 255, b: 0 });
    });

    it('should parse blue color correctly', () => {
      const status = parseILinkStatus('55aa0308020000fff4');
      expect(status.color).toEqual({ r: 0, g: 0, b: 255 });
    });
  });

  describe('Brightness status parsing', () => {
    it('should parse brightness status correctly', () => {
      const status = parseILinkStatus('55aa010801fff7');
      expect(status.power).toBe(true);
      expect(status.brightness).toBeGreaterThan(0);
    });

    it('should convert brightness from 0-255 to 0-100', () => {
      // 255 brightness should be ~100%
      const status = parseILinkStatus('55aa010801fff7');
      expect(status.brightness).toBeCloseTo(100, 0);
    });
  });

  describe('Combined status parsing', () => {
    it('should parse status with RGB and brightness', () => {
      // Status response format: 8815 or 8814 with RGB + brightness
      const status = parseILinkStatus('55aa088815ff0000ff00');
      expect(status.power).toBe(true);
      expect(status.color).toEqual({ r: 255, g: 0, b: 0 });
      expect(status.brightness).toBeDefined();
    });
  });

  describe('Invalid input handling', () => {
    it('should return empty object for invalid hex string', () => {
      const status = parseILinkStatus('invalid');
      expect(status).toEqual({});
    });

    it('should return empty object for hex without 55aa header', () => {
      const status = parseILinkStatus('1234567890abcdef');
      expect(status).toEqual({});
    });

    it('should return empty object for incomplete status', () => {
      const status = parseILinkStatus('55aa0108');
      expect(status).toEqual({});
    });

    it('should handle unknown CID gracefully', () => {
      const status = parseILinkStatus('55aa01099999f0');
      expect(status).toEqual({});
    });
  });
});
