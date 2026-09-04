/**
 * Real PDF encryption via qpdf (AES-256), compiled to WASM and run fully
 * offline. Replaces the old pdf-lib save-with-password path, which silently
 * produced UNENCRYPTED files (pdf-lib 1.17 has no encryption writer).
 *
 * Loaded lazily (dynamic import) so the ~45 KB JS wrapper + 1.3 MB .wasm stay
 * out of the entry chunk; the service worker precaches them after first load.
 */
import type { QpdfInstance } from '@neslinesli93/qpdf-wasm';
import wasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url';
import { UserError } from '../types.js';

let instance: QpdfInstance | null = null;
let fileCounter = 0;

// `process` typing without pulling @types/node into the browser bundle.
declare const process:
  | undefined
  | { cwd(): string; versions?: Record<string, string> };

/**
 * Where the .wasm bytes live. Browsers use the Vite-emitted asset URL;
 * Node (vitest) maps the dev-server public path back to disk — Emscripten
 * reads it with fs and never touches the network in either case.
 */
function locateWasm(): string {
  const clean = wasmUrl.split('?')[0];
  const isNode = typeof process !== 'undefined' && !!process?.versions?.node;
  if (isNode && clean.startsWith('/node_modules/') && typeof process?.cwd === 'function') {
    return process.cwd() + clean;
  }
  return wasmUrl;
}

/** Runtime FS surface (shipped .d.ts omits writeFile/unlink). */
interface QpdfFs {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
}

function fsOf(q: QpdfInstance): QpdfFs {
  return q.FS as unknown as QpdfFs;
}

async function qpdf(): Promise<QpdfInstance> {
  if (!instance) {
    const { default: createModule } = await import('@neslinesli93/qpdf-wasm');
    // Typings only declare locateFile; print/printErr capture is standard
    // Emscripten and needed to turn exit codes into helpful errors.
    instance = await createModule({
      locateFile: () => locateWasm(),
      print: () => {},
      printErr: () => {},
    } as never);
  }
  return instance;
}

/** Pure arg builders — unit-tested without loading WASM. */
export function buildEncryptArgs(userPassword: string, ownerPassword?: string): string[] {
  return ['--encrypt', userPassword, ownerPassword || userPassword, '256'];
}

export function buildDecryptArgs(password: string): string[] {
  return [`--password=${password}`, '--decrypt'];
}

function isPasswordError(output: string): boolean {
  return /password|decrypt/i.test(output);
}

async function runQpdf(input: Uint8Array, args: string[], op: 'encrypt' | 'decrypt'): Promise<Uint8Array> {
  const q = await qpdf();
  const n = ++fileCounter;
  const inPath = `/q-${n}-in.pdf`;
  const outPath = `/q-${n}-out.pdf`;
  let captured = '';
  // Emscripten module-level print hooks are set at init; per-call capture via
  // temporary override keeps concurrent-free sequential use honest.
  const mod = q as unknown as Record<string, unknown>;
  const prevPrint = mod['print'];
  const prevErr = mod['printErr'];
  mod['print'] = (t: string) => {
    captured += t + '\n';
  };
  mod['printErr'] = (t: string) => {
    captured += t + '\n';
  };
  try {
    fsOf(q).writeFile(inPath, input);
    // Note: qpdf's "invalid password" diagnostic bypasses the print hooks and
    // reaches the devtools console on error paths. Harmless (users never look
    // there); the mapped UserError below is what the UI shows.
    const code = q.callMain([inPath, ...args, '--', outPath]);
    if (code !== 0) {
      if (op === 'decrypt' || isPasswordError(captured)) {
        throw new UserError('Wrong password — the file is still locked. Check caps-lock and try again.');
      }
      throw new UserError(`Protect failed (${captured.trim().slice(0, 160) || `exit ${code}`}). Try a smaller file.`);
    }
    let out: Uint8Array;
    try {
      out = fsOf(q).readFile(outPath);
    } catch {
      throw new UserError('Protect failed — no output produced. Try a smaller file.');
    }
    return out;
  } finally {
    mod['print'] = prevPrint;
    mod['printErr'] = prevErr;
    const fs = fsOf(q);
    for (const p of [inPath, outPath]) {
      try {
        fs.unlink(p);
      } catch {
        /* already gone */
      }
    }
  }
}

export async function qpdfEncrypt(
  bytes: ArrayBuffer,
  userPassword: string,
  ownerPassword?: string,
): Promise<Uint8Array> {
  return runQpdf(new Uint8Array(bytes), [...buildEncryptArgs(userPassword, ownerPassword)], 'encrypt');
}

export async function qpdfDecrypt(bytes: ArrayBuffer, password: string): Promise<Uint8Array> {
  return runQpdf(new Uint8Array(bytes), buildDecryptArgs(password), 'decrypt');
}
