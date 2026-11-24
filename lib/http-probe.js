export function validateProbeAccept(value) {
  if (value !== undefined && (!Array.isArray(value) || value.length === 0 || value.length > 500 || value.some(code => !Number.isInteger(code) || code < 100 || code > 599))) {
    throw new Error('probeAccept 必须是非空 HTTP 状态码数组（100–599 整数）');
  }
}

export async function probe(url, signal, accept) {
  validateProbeAccept(accept);
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('业务探活只接受无凭据的 HTTP(S) URL');
  // Explicit policies inspect the original response, never the redirect destination.
  const response = await fetch(parsed, { method: 'HEAD', redirect: accept === undefined ? 'error' : 'manual', signal });
  return { probeOk: accept === undefined ? response.ok : accept.includes(response.status), probeStatus: response.status, probeAccept: accept ?? '200–299' };
}
