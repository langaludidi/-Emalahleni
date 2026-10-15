export const startupReasons = ['CONFIGURATION', 'INSTANCE', 'PORT', 'EXIT', 'RPC', 'UNKNOWN'] as const;
export type StartupReason = typeof startupReasons[number];

// Inspect only known SDK errors. Return a fixed code; never return or log the
// provider message, environment, token, request, or document contents.
export function startupReason(error: unknown): StartupReason {
  const message = (error instanceof Error ? error.message : typeof error === 'string' ? error : '').slice(0, 1024);
  if (/containers have not been enabled|ctx\.container|container.*not (?:enabled|configured)/i.test(message)) return 'CONFIGURATION';
  if (/(?:startAndWaitForPorts|getByName|fetch).*(?:not (?:a function|implemented|found)|does not exist)|RPC.*(?:not found|unsupported|not implemented|cannot serialize)/i.test(message)) return 'RPC';
  if (/exit code|container (?:crashed|exited)|process.*exit/i.test(message)) return 'EXIT';
  if (/failed to verify port|not.*listening|connection refused|port.*(?:not.*(?:ready|available)|timeout)/i.test(message)) return 'PORT';
  if (/no container instance|no.*instance.*running|container did not start|instance.*(?:timeout|timed out|not available)/i.test(message)) return 'INSTANCE';
  return 'UNKNOWN';
}
