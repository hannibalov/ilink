/**
 * Serializes BLE operations so only one runs at a time.
 * Prevents adapter crashes when multiple connects happen simultaneously (e.g. on Linux/BlueZ).
 */
export class BleQueue {
  private queue: Promise<void> = Promise.resolve();

  schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue = this.queue
        .then(() => task())
        .then((result) => {
          resolve(result);
        })
        .catch((err) => {
          console.error('[BLE] Task failed:', err);
          reject(err);
        });
    });
  }
}
