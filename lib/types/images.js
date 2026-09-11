const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
function isBlockedIpv4(ip) {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
    if (match === null)
        return false;
    const first = Number(match[1]);
    const second = Number(match[2]);
    return first === 0 || first === 127 || (first === 169 && second === 254);
}
/**
 * Reject remote image hosts that can never be a legitimate evidence source:
 * loopback, link-local (including cloud metadata), and mDNS names. Private
 * ranges stay allowed because internal artifact servers are a real use case.
 *
 * Decimal/octal/hex IPv4 spellings and fully-expanded IPv6 never reach this
 * function: `new URL()` canonicalises them first (2130706433 -> 127.0.0.1,
 * 0::1 -> ::1). What does survive is a trailing FQDN dot and the deprecated
 * IPv4-compatible IPv6 form (::127.0.0.1 -> ::7f00:1), so both are handled here.
 * @param hostname - URL hostname, brackets stripped by the caller.
 * @returns True when the host must not be fetched.
 */
export function isBlockedImageHost(hostname) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))
        return true;
    if (host.includes(':')) {
        if (host === '::' || host === '::1' || host === '::0' || host === '0:0:0:0:0:0:0:0' || host === '0:0:0:0:0:0:0:1')
            return true;
        // `ffff:` is optional so the IPv4-compatible form is unwrapped as well.
        const mappedDotted = /^(?:(?:0+:){5}|::)(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(host);
        if (mappedDotted !== null)
            return isBlockedIpv4(mappedDotted[1]);
        const mappedHex = /^(?:(?:0+:){5}|::)(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
        if (mappedHex !== null) {
            const hi = parseInt(mappedHex[1], 16);
            const lo = parseInt(mappedHex[2], 16);
            const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
            return isBlockedIpv4(dotted);
        }
        return /^fe80:/i.test(host) || /^f[cd]/i.test(host);
    }
    return isBlockedIpv4(host);
}
function parseDataUrl(value) {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(value);
    if (!match)
        return undefined;
    const data = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (data.byteLength > MAX_IMAGE_BYTES)
        throw new Error('llm-verifier: image exceeds 20 MiB');
    return { mediaType: match[1].toLowerCase(), data };
}
export async function loadVerifierImages(inputs, signal) {
    const images = [];
    for (const input of inputs ?? []) {
        const data = parseDataUrl(input);
        if (data !== undefined) {
            images.push(data);
            continue;
        }
        let url;
        try {
            url = new URL(input);
        }
        catch {
            throw new Error('llm-verifier: images accept only HTTPS URLs or data:image/...;base64 URLs');
        }
        if (url.protocol !== 'https:')
            throw new Error('llm-verifier: remote images must use HTTPS');
        if (isBlockedImageHost(url.hostname))
            throw new Error('llm-verifier: refusing to fetch a loopback or link-local image URL');
        // Bounded fetch: the caller's signal alone would let a stalled host hold the
        // whole verification open.
        const response = await fetch(url, { redirect: 'error', headers: { accept: 'image/*' }, signal: signal === undefined ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) });
        if (!response.ok)
            throw new Error('llm-verifier: image fetch returned HTTP ' + response.status);
        const type = (response.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
        if (!TYPES.has(type))
            throw new Error('llm-verifier: unsupported image media type ' + type);
        const declared = Number(response.headers.get('content-length') ?? 0);
        if (declared > MAX_IMAGE_BYTES)
            throw new Error('llm-verifier: image exceeds 20 MiB');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_IMAGE_BYTES)
            throw new Error('llm-verifier: image exceeds 20 MiB');
        images.push({ mediaType: type, data: bytes });
    }
    return images;
}
//# sourceMappingURL=images.js.map