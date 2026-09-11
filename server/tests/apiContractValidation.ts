/**
 * server/tests/apiContractValidation.ts
 * Empirical validation script for Phase 0.5 (External Contract Validation).
 * Probes the Community API to test:
 * 1. Endpoint availability & HTTP status (public vs authenticated)
 * 2. Rate limit headers (limit, remaining, reset, retry-after)
 * 3. Latency benchmarks (round-trip time in ms)
 * 4. Response payload sizes
 * 5. Batch support testing (single vs comma-separated vs array)
 */

import 'dotenv/config';

interface ProbeResult {
  url: string;
  status: number;
  statusText: string;
  latencyMs: number;
  contentLengthBytes: number;
  rateLimitHeaders: Record<string, string>;
  isJson: boolean;
  error?: string;
  sampleKeys?: string[];
}

async function probeEndpoint(url: string, headers: Record<string, string> = {}): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    const latencyMs = Date.now() - start;
    const rateLimitHeaders: Record<string, string> = {};
    for (const [k, v] of res.headers.entries()) {
      if (k.toLowerCase().includes('ratelimit') || k.toLowerCase().includes('retry') || k.toLowerCase().includes('limit')) {
        rateLimitHeaders[k] = v;
      }
    }

    const text = await res.text();
    let isJson = false;
    let sampleKeys: string[] | undefined;
    try {
      const parsed = JSON.parse(text);
      isJson = true;
      sampleKeys = Object.keys(parsed);
    } catch {
      isJson = false;
    }

    return {
      url,
      status: res.status,
      statusText: res.statusText,
      latencyMs,
      contentLengthBytes: Buffer.byteLength(text, 'utf8'),
      rateLimitHeaders,
      isJson,
      sampleKeys,
    };
  } catch (err: any) {
    return {
      url,
      status: 0,
      statusText: 'FETCH_ERROR',
      latencyMs: Date.now() - start,
      contentLengthBytes: 0,
      rateLimitHeaders: {},
      isJson: false,
      error: err.message,
    };
  }
}

async function runValidation() {
  console.log('=== Probing Sunflower Land Community API Endpoints ===\n');

  const baseUrl = process.env.SUNFLOWER_API_URL || 'https://api.sunflower-land.com';
  const apiKey = process.env.SUNFLOWER_API_KEY;
  const testFarmId = process.env.SUNFLOWER_FARM_ID || '10340';

  const defaultHeaders: Record<string, string> = apiKey ? { 'x-api-key': apiKey } : {};

  const tests: Array<{ label: string; url: string; headers: Record<string, string> }> = [
    { label: 'Single Farm (Standard)', url: `${baseUrl}/community/farms/${testFarmId}`, headers: defaultHeaders },
    { label: 'Single Farm (Unauthenticated)', url: `${baseUrl}/community/farms/${testFarmId}`, headers: {} },
    { label: 'Low Farm ID (ID 1)', url: `${baseUrl}/community/farms/1`, headers: defaultHeaders },
    { label: 'Batch Attempt: Comma-Separated', url: `${baseUrl}/community/farms/${testFarmId},1`, headers: defaultHeaders },
    { label: 'Batch Attempt: Query Param ids', url: `${baseUrl}/community/farms?ids=${testFarmId},1`, headers: defaultHeaders },
    { label: 'Alternative: SFL.world Land API', url: `https://sfl.world/api/v1.1/land/${testFarmId}`, headers: {} },
    { label: 'Market Prices (sfl.world)', url: process.env.PRICES_API_URL || 'https://sfl.world/api/v1/prices', headers: {} },
  ];

  for (const t of tests) {
    console.log(`Testing [${t.label}]: ${t.url}`);
    const result = await probeEndpoint(t.url, t.headers);
    console.log(`  -> Status: ${result.status} ${result.statusText}`);
    console.log(`  -> Latency: ${result.latencyMs}ms`);
    console.log(`  -> Size: ${(result.contentLengthBytes / 1024).toFixed(2)} KB`);
    console.log(`  -> Rate Limit Headers:`, Object.keys(result.rateLimitHeaders).length ? result.rateLimitHeaders : 'None returned');
    if (result.isJson && result.sampleKeys) {
      console.log(`  -> JSON Top Keys:`, result.sampleKeys.slice(0, 5));
    }
    if (result.error) {
      console.log(`  -> Error:`, result.error);
    }
    console.log('');
  }
}

runValidation();
