/**
 * Stage H0b Part 1. Express's `trust proxy` setting decides what `req.ip`
 * means, and every anonymous throttle key (the global bucket, login-ip,
 * login-identifier, signup-identifier, signup-ip) is built from it. Behind a
 * reverse proxy (the Hetzner deployment plan: nginx/Caddy/a load balancer in
 * front), an unconfigured `req.ip` resolves to the PROXY's address for every
 * request - collapsing every one of those per-client limits into one shared
 * limit for the whole product.
 *
 * Never `true` here: that trusts the client's own X-Forwarded-For at face
 * value, letting a client pick its own IP for throttle-key purposes - worse
 * than the un-configured case, since it defeats the IP-based limits entirely
 * rather than merely collapsing them. The only values this accepts are:
 *
 *   - "" / "0"      -> disabled (Express default: req.ip is the raw socket
 *                      address, X-Forwarded-For is ignored). Dev/test default.
 *   - a positive integer N -> trust exactly the N hops closest to the server
 *                      (Express's own "trust proxy" hop-count semantics: the
 *                      Nth-from-the-right entry in X-Forwarded-For is treated
 *                      as the client, everything closer to the server is a
 *                      trusted proxy). Set to 1 for exactly one reverse proxy
 *                      in front, matching the Hetzner plan.
 *   - a comma-separated list of IP addresses/CIDR subnets -> trust
 *                      X-Forwarded-For only when it arrives via one of these
 *                      addresses (Express's own address-based form), for when
 *                      the proxy's address is known and fixed rather than
 *                      "however many hops".
 *
 * Anything else throws at startup - a nonsensical value must fail loudly,
 * never fall back to something permissive.
 */
const ADDRESS_OR_CIDR = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;

export function parseTrustProxy(raw: string | undefined): number | string | false {
  const value = (raw ?? '').trim();

  if (value === '' || value === '0') {
    return false;
  }

  if (/^true$/i.test(value) || value === '*') {
    throw new Error(
      `TRUST_PROXY="${raw}" is not allowed - trusting every proxy accepts a client-supplied ` +
        'X-Forwarded-For at face value, letting a client pick its own IP for rate-limiting ' +
        'purposes. Set a specific hop count (e.g. "1") or proxy address/subnet instead.',
    );
  }

  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops <= 0) {
      throw new Error(
        `TRUST_PROXY="${raw}" must be a positive hop count, or "0"/empty to disable.`,
      );
    }
    return hops;
  }

  const parts = value.split(',').map((part) => part.trim());
  if (parts.every((part) => part.length > 0 && ADDRESS_OR_CIDR.test(part))) {
    return value;
  }

  throw new Error(
    `TRUST_PROXY="${raw}" is not recognized - use a hop count (e.g. "1"), a comma-separated ` +
      'list of proxy IP addresses/CIDR subnets (e.g. "10.0.0.5"), or "0"/empty to disable.',
  );
}
