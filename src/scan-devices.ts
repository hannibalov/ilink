import noble from '@abandonware/noble';

/**
 * Utility script to scan for iLink devices
 * Run with: npm run scan or yarn scan
 */

async function scanForDevices() {
  console.log('Scanning for Bluetooth devices...');
  console.log('Press Ctrl+C to stop\n');

  return new Promise<void>((resolve) => {
    noble.on('stateChange', async (state) => {
      if (state === 'poweredOn') {
        console.log('Bluetooth adapter ready. Starting scan...\n');
        await noble.startScanning([], true);
      } else {
        console.log(`Bluetooth adapter state: ${state}`);
      }
    });

    const foundDevices = new Map<string, { name: string; rssi: number; address: string }>();

    noble.on('discover', (peripheral: any) => {
      const id = peripheral.id || peripheral.address;
      const name = peripheral.advertisement.localName || 'Unknown';
      const rssi = peripheral.rssi || 0;
      const address = peripheral.address || id;

      if (!foundDevices.has(id)) {
        foundDevices.set(id, { name, rssi, address });
        
        // Check if it might be an iLink device (look for service UUID a032)
        const serviceUuids = peripheral.advertisement.serviceUuids || [];
        const isILink = serviceUuids.some((uuid: string) => 
          uuid.toLowerCase().replace(/-/g, '').includes('a032')
        );

        const iLinkIndicator = isILink ? ' [iLink?]' : '';
        
        console.log(`Found: ${name}`);
        console.log(`  ID: ${id}`);
        console.log(`  Address: ${address}`);
        console.log(`  RSSI: ${rssi} dBm`);
        console.log(`  Services: ${serviceUuids.join(', ') || 'None'}${iLinkIndicator}`);
        console.log('');
      }
    });

    // Handle Ctrl+C
    process.on('SIGINT', async () => {
      console.log('\n\nScan stopped.');
      await noble.stopScanningAsync();
      
      if (foundDevices.size > 0) {
        console.log('\nSummary:');
        console.log('Add devices to your DEVICES environment variable like this:');
        console.log('\nDEVICES=[');
        let first = true;
        for (const [id, device] of foundDevices) {
          if (!first) console.log(',');
          console.log(`  {`);
          console.log(`    "id": "${device.name.toLowerCase().replace(/\s+/g, '_')}",`);
          console.log(`    "name": "${device.name}",`);
          console.log(`    "macAddress": "${device.address}",`);
          console.log(`    "targetChar": "a040",`);
          console.log(`    "statusChar": "a042"`);
          console.log(`  }`);
          first = false;
        }
        console.log(']');
      }
      
      resolve();
      process.exit(0);
    });

    if (noble.state === 'poweredOn') {
      noble.startScanning([], true);
    }
  });
}

scanForDevices().catch(console.error);
