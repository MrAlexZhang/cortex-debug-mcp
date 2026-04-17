/**
 * Low-level OpenOCD telnet client.
 * Opens one TCP connection per call and executes all commands in sequence.
 * Used by peripheral tools (spi_transfer, i2c_transaction, etc.) that need
 * multiple register reads/writes over a single session.
 */

import * as net from 'net';
import * as logger from '../logger';

const OPENOCD_TELNET_PORT = 50002;
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Executes multiple OpenOCD telnet commands in a single connection.
 * Returns an array of response strings (one per command, trimmed, no prompt).
 */
export async function openocdBatch(
  commands: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(OPENOCD_TELNET_PORT, 'localhost');
    let buf = '';
    let ready = false;
    let cmdIndex = 0;
    const responses: string[] = [];
    let done = false;

    const cleanup = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      try { sock.destroy(); } catch (_) { /* ignore */ }
      if (err) reject(err);
      else resolve(responses);
    };

    const timeout = setTimeout(() => {
      cleanup(new Error(`OpenOCD telnet timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const sendNext = () => {
      if (cmdIndex < commands.length) {
        buf = '';
        const cmd = commands[cmdIndex];
        logger.debug(`openocdBatch[${cmdIndex}]: "${cmd}"`);
        sock.write(cmd + '\n');
      } else {
        sock.write('exit\n');
        cleanup();
      }
    };

    sock.on('data', (data: Buffer) => {
      if (done) return;
      buf += data.toString('latin1');

      if (!ready) {
        if (buf.includes('> ')) {
          ready = true;
          sendNext();
        }
        return;
      }

      if (buf.includes('> ')) {
        const promptIdx = buf.lastIndexOf('> ');
        const responseText = buf.slice(0, promptIdx).trim();
        responses[cmdIndex] = responseText;
        cmdIndex++;
        sendNext();
      }
    });

    sock.on('error', (err: Error) =>
      cleanup(new Error(`OpenOCD telnet error: ${err.message}`))
    );

    sock.on('connect', () =>
      logger.debug('openocdBatch: connected')
    );
  });
}

/** Execute a single command, return the response string. */
export async function openocdSend(cmd: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const res = await openocdBatch([cmd], timeoutMs);
  return res[0] ?? '';
}

/** Write a 32-bit word to address. */
export async function mww(address: number | string, value: number | string): Promise<void> {
  const addr = addrHex(address);
  const val  = valHex(value);
  await openocdSend(`mww ${addr} ${val}`);
}

/** Write an 8-bit byte to address. */
export async function mwb(address: number | string, value: number | string): Promise<void> {
  const addr = addrHex(address);
  const val  = valHex(value);
  await openocdSend(`mwb ${addr} ${val}`);
}

/**
 * Read `count` 32-bit words starting at address.
 * Returns an array of hex strings like ["aabbccdd", "11223344"].
 * Handles multi-line output (every 4 words per line).
 */
export async function mdw(address: number | string, count = 1): Promise<string[]> {
  const addr = addrHex(address);
  const response = await openocdSend(`mdw ${addr} ${count}`);
  const words: string[] = [];
  for (const line of response.split(/\r?\n/)) {
    const m = line.match(/0x[0-9a-f]+:\s+([\da-f\s]+)/i);
    if (m) {
      words.push(...m[1].trim().split(/\s+/).filter(Boolean));
    }
  }
  return words;
}

/** Read a single 32-bit word, returns the numeric value (unsigned). */
export async function mdwOne(address: number | string): Promise<number> {
  const words = await mdw(address, 1);
  return words.length > 0 ? (parseInt(words[0], 16) >>> 0) : 0;
}

/**
 * Read `count` bytes from address.
 * Returns an array of numeric byte values.
 */
export async function mdb(address: number | string, count = 1): Promise<number[]> {
  const addr = addrHex(address);
  const response = await openocdSend(`mdb ${addr} ${count}`);
  const bytes: number[] = [];
  for (const line of response.split(/\r?\n/)) {
    const m = line.match(/0x[0-9a-f]+:\s+([\da-f\s]+)/i);
    if (m) {
      bytes.push(
        ...m[1].trim().split(/\s+/).filter(Boolean).map(b => parseInt(b, 16))
      );
    }
  }
  return bytes;
}

/**
 * Atomic bit set/clear using OpenOCD `mmw` command.
 * `mmw address setbits clearbits` — sets bits in setbits, clears bits in clearbits.
 * A single telnet connection, no read-modify-write race.
 *
 * For setBits(addr, mask, value): bits in `mask` get written with the pattern
 * in `value`. Bits outside the mask are untouched. Bits in `mask & ~value`
 * are cleared; bits in `mask & value` are set.
 */
export async function setBits(
  address: number | string,
  mask: number,
  value: number
): Promise<number> {
  const addr = addrHex(address);
  const setBitsVal   = (value & mask) >>> 0;
  const clearBitsVal = (mask & ~value) >>> 0;
  await openocdSend(`mmw ${addr} 0x${setBitsVal.toString(16)} 0x${clearBitsVal.toString(16)}`);
  logger.debug(`setBits ${addr}: set=0x${setBitsVal.toString(16)} clear=0x${clearBitsVal.toString(16)}`);
  return 0;  // Return value no longer meaningful without read
}

/** Execute an OpenOCD sleep (milliseconds) — blocks the current batch connection. */
export async function openocdSleep(ms: number): Promise<void> {
  await openocdSend(`sleep ${ms}`);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function addrHex(v: number | string): string {
  return typeof v === 'number' ? `0x${v.toString(16).padStart(8, '0')}` : v;
}

function valHex(v: number | string): string {
  if (typeof v === 'number') {
    return `0x${(v >>> 0).toString(16)}`;
  }
  return v;
}
