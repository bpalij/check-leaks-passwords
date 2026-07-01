import {
  passwordObject,
  hashWithLeaksAndPasswordObjects,
} from '../interfaces/types';
import { HASH_PREFIX_LENGTH, HIBP_API_URL } from '../constants';
import groupHashesByPrefix from './groupHashesByPrefix';
import buildFingerprintSet from './buildFingerprintSet';
import parseBuffer from './parseBuffer';
import beautifullyPrintNumber from './beautifullyPrintNumber';
import timeDurationBetweenDatesInWords from './timeDurationBetweenDatesInWords';
import estimatedTimeRemaining from './estimatedTimeRemaining';

export default async function processHibpApi(
  hashesWithPasswordObjects: Map<string, Array<passwordObject>>,
  logger?: (message: string) => void,
): Promise<Array<hashWithLeaksAndPasswordObjects>> {
  const prefixToSuffixMap = groupHashesByPrefix(hashesWithPasswordObjects, HASH_PREFIX_LENGTH);
  const matchingPrefixes = Array.from(prefixToSuffixMap.keys());
  const totalPrefixes = matchingPrefixes.length;
  const results: Array<hashWithLeaksAndPasswordObjects> = [];
  if (totalPrefixes === 0) return results;

  const allSuffixes = Array.from(prefixToSuffixMap.values()).flatMap((m) => Array.from(m.keys()));
  const fingerprintSet = buildFingerprintSet(allSuffixes);

  const startTime = new Date();

  let processedCount = 0;
  let totalMatchedHashCount = 0;
  let totalCumulativeLeakCount = 0;
  let cfHits = 0;
  let cfMisses = 0;
  let lastLogTime = startTime;
  let lastProcessedCount = 0;
  let progressInterval: ReturnType<typeof setInterval> | undefined;

  const logProgress = () => {
    if (!logger) return;
    const now = new Date();
    const elapsedSeconds = (now.getTime() - lastLogTime.getTime()) / 1000;
    const requestsPerSecond = elapsedSeconds === 0
      ? 0
      : Math.round((processedCount - lastProcessedCount) / elapsedSeconds);
    const percentage = ` (${Math.floor((processedCount / totalPrefixes) * 100 * 100) / 100}%)`;
    logger(
      `Already checked ${beautifullyPrintNumber(processedCount)}`
      + ` from ${beautifullyPrintNumber(totalPrefixes)}${percentage} prefix requests`,
    );
    logger(`Checking ${beautifullyPrintNumber(requestsPerSecond)} avg requests per second`);
    logger(`Checking passwords time: ${timeDurationBetweenDatesInWords(startTime, new Date())}`);
    if (processedCount >= totalPrefixes) {
      logger('Estimated time remaining: finishing up...');
    } else if (processedCount > 0 && elapsedSeconds > 0) {
      const elapsedMs = now.getTime() - startTime.getTime();
      const eta = estimatedTimeRemaining(processedCount, totalPrefixes, elapsedMs);
      if (eta !== undefined) {
        logger(`Estimated time remaining: ${eta}`);
      }
    }
    lastProcessedCount = processedCount;
    lastLogTime = now;
  };

  const fetchWithRetry = async (prefix: string): Promise<Response> => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(`${HIBP_API_URL}${prefix}`, {
          signal: AbortSignal.timeout(5000),
          headers: {
            'User-Agent': 'check-leaks-passwords/0.0.0',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response;
      } catch (err) {
        if (attempt >= 10) {
          throw err instanceof Error
            ? err
            : new Error(`Failed to fetch prefix ${prefix} after 10 attempts`);
        }
        if (logger) {
          const message = err instanceof Error ? err.message : String(err);
          logger(
            `Failed attempt #${attempt} while fetching prefix ${prefix}. ${message}`,
          );
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    throw new Error('Unexpected end of retry loop');
  };

  const fetchAndParse = async (prefix: string): Promise<void> => {
    const suffixLookupMap = prefixToSuffixMap.get(prefix);
    if (!suffixLookupMap) {
      throw new Error(`Invariant: prefix "${prefix}" not found in prefixToSuffixMap`);
    }

    const response = await fetchWithRetry(prefix);

    const cfStatus = response.headers.get('cf-cache-status');
    if (cfStatus === 'HIT') {
      cfHits += 1;
    } else {
      cfMisses += 1;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    const stats = parseBuffer(
      buffer, prefix, suffixLookupMap, results, 'ascii', fingerprintSet,
    );

    totalMatchedHashCount += stats.matchedHashCount;
    totalCumulativeLeakCount += stats.cumulativeLeakCount;
  };

  if (logger) {
    progressInterval = setInterval(logProgress, 1000);
    logProgress();
  }

  const tasks = matchingPrefixes.map(async (prefix) => {
    await fetchAndParse(prefix);
    processedCount += 1;
  });

  try {
    await Promise.all(tasks);
  } finally {
    clearInterval(progressInterval);
  }

  logProgress();

  if (logger) {
    const totalElapsed = (Date.now() - startTime.getTime()) / 1000;
    const avgPerSecond = totalElapsed === 0
      ? 0
      : Math.round(totalPrefixes / totalElapsed);
    const cfTotal = cfHits + cfMisses;
    const hitPct = cfTotal === 0 ? '0.0' : ((cfHits / cfTotal) * 100).toFixed(1);
    const missPct = cfTotal === 0 ? '0.0' : ((cfMisses / cfTotal) * 100).toFixed(1);
    logger(
      `Checked all ${beautifullyPrintNumber(totalPrefixes)} prefix requests.`
      + ` Found ${beautifullyPrintNumber(totalMatchedHashCount)} hashes`
      + ` with total ${beautifullyPrintNumber(totalCumulativeLeakCount)} leaks`,
    );
    logger(`Processing ${beautifullyPrintNumber(avgPerSecond)} avg requests per second`);
    logger(`Cloudflare cache: ${cfTotal} total, hit: ${cfHits} (${hitPct}%), miss: ${cfMisses} (${missPct}%)`);
    logger(`Checked passwords in ${timeDurationBetweenDatesInWords(startTime, new Date())}`);
  }

  return results;
}
