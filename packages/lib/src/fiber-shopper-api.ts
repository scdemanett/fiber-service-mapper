import https from 'https';
import { decodeResponse } from './fiber-decoder';

const API_URL = 'https://shop.omnifiber.com/api/getCatalog';

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [1000, 3000];
const ATTEMPT_TIMEOUT_MS = 30_000;

// Reuse sockets across requests for better throughput/latency.
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 16,
  maxFreeSockets: 16,
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Single POST to getCatalog. Throws on transport failure, timeout, non-2xx, or decode error.
 */
function fetchShopperDataOnce(address: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(API_URL);

    const payload = {
      inputAddress: {
        inputAddress: address,
      },
    };

    const postData = JSON.stringify(payload);

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Origin: 'https://shop.omnifiber.com',
      Referer: 'https://shop.omnifiber.com/',
      'Content-Length': Buffer.byteLength(postData).toString(),
    };

    const options: https.RequestOptions = {
      agent,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname,
      method: 'POST',
      headers,
    };

    let attemptTimeout: ReturnType<typeof setTimeout> | undefined;
    const clearAttemptTimeout = () => {
      if (attemptTimeout !== undefined) {
        clearTimeout(attemptTimeout);
        attemptTimeout = undefined;
      }
    };

    const req = https.request(options, (res) => {
      const statusCode = res.statusCode ?? 0;
      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        res.on('end', () => {
          clearAttemptTimeout();
          reject(new Error(`HTTP ${statusCode}`));
        });
        return;
      }

      const contentEncoding = res.headers['content-encoding'] || '';
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        clearAttemptTimeout();
        try {
          const rawBytes = Buffer.concat(chunks);
          const data = decodeResponse(rawBytes, contentEncoding);
          resolve(data);
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Decode failed';
          reject(new Error(message));
        }
      });
    });

    attemptTimeout = setTimeout(() => {
      req.destroy(new Error(`Request timeout after ${ATTEMPT_TIMEOUT_MS}ms`));
    }, ATTEMPT_TIMEOUT_MS);

    req.on('error', (error) => {
      clearAttemptTimeout();
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Fetch shopper data from the fiber service API.
 *
 * Retries transient failures up to three times with backoff. Returns `null` only
 * after all attempts fail.
 */
export async function fetchShopperData(address: string): Promise<unknown | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchShopperDataOnce(address);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';

      if (attempt < MAX_ATTEMPTS) {
        const delayMs = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
        console.warn(
          `[omni-fiber] fetch failed for ${address} (attempt ${attempt}/${MAX_ATTEMPTS}): ${message} — retrying in ${delayMs}ms`
        );
        await sleep(delayMs);
        continue;
      }

      console.error(
        `[omni-fiber] fetch failed for ${address} after ${MAX_ATTEMPTS} attempts:`,
        message
      );
    }
  }

  return null;
}
