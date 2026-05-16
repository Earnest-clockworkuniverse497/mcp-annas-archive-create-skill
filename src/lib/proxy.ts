/**
 * Optional outbound proxy for Anna's Archive traffic.
 *
 * Reads env in this priority order:
 *   1. ANNAS_HTTPS_PROXY  — scope-specific (this MCP only, leaves Gemini direct)
 *   2. HTTPS_PROXY / https_proxy  — system-wide
 *   3. HTTP_PROXY  / http_proxy   — system-wide
 *
 * Supported URL schemes:
 *   - http://[user:pass@]host:port
 *   - https://[user:pass@]host:port
 *   - socks5://[user:pass@]host:port   (also socks://, socks4://)
 *
 * If none of the above are set, fetch goes directly (no proxy).
 *
 * WireGuard note: WG is a system-level VPN, not an app-level proxy. Either run
 * this server inside a network namespace where the WG interface is the default
 * route, or have your WG endpoint expose a SOCKS5/HTTP forward proxy and put
 * its URL into ANNAS_HTTPS_PROXY.
 */
import { ProxyAgent, type Dispatcher } from "undici";
import { SocksProxyAgent } from "socks-proxy-agent";

let cached: Dispatcher | null | undefined;

function pickProxyUrl(): string | null {
  return (
    process.env.ANNAS_HTTPS_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    null
  );
}

export function getAnnasDispatcher(): Dispatcher | undefined {
  if (cached !== undefined) return cached ?? undefined;
  const url = pickProxyUrl();
  if (!url) {
    cached = null;
    return undefined;
  }
  const scheme = url.split(":", 1)[0]?.toLowerCase();
  if (scheme === "socks" || scheme === "socks4" || scheme === "socks5" || scheme === "socks5h") {
    cached = new SocksProxyAgent(url) as unknown as Dispatcher;
  } else if (scheme === "http" || scheme === "https") {
    cached = new ProxyAgent(url);
  } else {
    throw new Error(
      `unsupported proxy scheme "${scheme}://" in ANNAS_HTTPS_PROXY/HTTPS_PROXY. Use http://, https://, or socks5://`,
    );
  }
  return cached;
}

export function describeProxy(): string {
  const url = pickProxyUrl();
  if (!url) return "no proxy";
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}:${u.port || "(default)"}`;
  } catch {
    return "proxy configured (URL parse failed)";
  }
}
