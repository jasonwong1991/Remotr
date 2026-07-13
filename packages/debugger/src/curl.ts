import type { NetworkRecord } from './store';

/**
 * Wrap a value in single quotes for POSIX shells, escaping any embedded
 * single quote as `'\''` (close-quote, escaped-quote, reopen-quote).
 * Safe for arbitrary bytes: nothing inside single quotes is interpreted.
 */
function shellQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

/**
 * Build a runnable `curl` command reproducing a captured HTTP request.
 * Emits `-X` only for non-GET verbs (curl defaults to GET; POST is implied
 * by a body but we keep the verb explicit for clarity), one `-H` per request
 * header, and `--data-raw` when a request body was captured.
 *
 * Header/body values are single-quote escaped so quotes, spaces and shell
 * metacharacters survive a copy-paste unchanged.
 */
export function buildCurl(record: NetworkRecord): string {
  const req = record.request;
  const url = req?.url ?? '';
  const method = (req?.method ?? 'GET').toUpperCase();

  const parts: string[] = ['curl'];

  if (method !== 'GET') {
    parts.push('-X', method);
  }

  parts.push(shellQuote(url));

  for (const [name, value] of Object.entries(req?.headers ?? {})) {
    parts.push('-H', shellQuote(`${name}: ${value}`));
  }

  if (req?.body != null && req.body !== '') {
    parts.push('--data-raw', shellQuote(req.body));
  }

  return parts.join(' ');
}
