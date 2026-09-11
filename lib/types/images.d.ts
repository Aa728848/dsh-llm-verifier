import type { VerifierImage } from './caller.ts';
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
export declare function isBlockedImageHost(hostname: string): boolean;
export declare function loadVerifierImages(inputs: readonly string[] | undefined, signal?: AbortSignal): Promise<VerifierImage[]>;
//# sourceMappingURL=images.d.ts.map