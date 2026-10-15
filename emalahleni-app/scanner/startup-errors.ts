export const startupReasons = ['CONFIGURATION', 'INSTANCE', 'PORT', 'EXIT', 'RPC', 'UNKNOWN'] as const;
export type StartupReason = typeof startupReasons[number];

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (typeof error !== 'object' || error === null) return '';
  try { return typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : ''; }
  catch { return ''; }
}

function errorMessages(error: unknown): string[] {
  const messages:string[]=[],seen=new Set<unknown>();
  for(let depth=0;depth<3&&error!==null&&error!==undefined&&!seen.has(error);depth++){
    seen.add(error);const message=errorMessage(error);if(message)messages.push(message.slice(0,16_384));
    if(typeof error!=='object')break;
    try{error=(error as {cause?:unknown}).cause;}catch{break;}
  }
  return messages;
}

// Inspect only known SDK errors. Return a fixed code; never return or log the
// provider message, environment, token, request, or document contents.
export function startupReason(error: unknown): StartupReason {
  const message = errorMessages(error).map(message=>message.slice(0,1024)).join(' | ');
  if (/containers have not been enabled|ctx\.container|container.*not (?:enabled|configured)/i.test(message)) return 'CONFIGURATION';
  if (/(?:startAndWaitForPorts|getByName|fetch).*(?:not (?:a function|implemented|found)|does not exist)|RPC.*(?:not found|unsupported|not implemented|cannot serialize)/i.test(message)) return 'RPC';
  if (/exit code|container (?:crashed|exited)|process.*exit/i.test(message)) return 'EXIT';
  if (/failed to verify port|not.*listening|connection refused|port.*(?:not.*(?:ready|available)|timeout)/i.test(message)) return 'PORT';
  if (/no container instance|no.*instance.*running|container did not start|instance.*(?:timeout|timed out|not available)/i.test(message)) return 'INSTANCE';
  return 'UNKNOWN';
}

// Used only for lifecycle failures before a document reaches the scanner.
// Details stay in private operational logs, never in the HTTP response.
export function startupDiagnostic(error: unknown, environment: object) {
  let message = errorMessages(error).join(' caused by: ');
  const secrets = Object.values(environment).filter((value): value is string => typeof value === 'string' && value.length >= 8);
  for (const secret of secrets.sort((a,b) => b.length-a.length)) {
    for (const variant of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1,-1)]) {
      message = message.split(variant).join('[redacted]');
    }
  }
  message = message
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [redacted]')
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"']+/gi, '[redacted URL]')
    .replace(/((?:password|token|secret|api[_-]?key|authorization)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[redacted]')
    .replace(/\b[A-Za-z0-9_+/=-]{40,}\b/g, '[redacted]')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .slice(0, 1024);
  return { reason: startupReason(error), errorMessage: message || 'No message supplied by runtime' };
}
