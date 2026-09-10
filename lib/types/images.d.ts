import type { VerifierImage } from './caller.ts';
/**
 * Reject remote image hosts that can never be a legitimate evidence source:
 * loopback, link-local (including cloud metadata), and mDNS names. Private
 * ranges stay allowed because internal artifact servers are a real use case.
 * @param hostname - URL hostname, brackets stripped by the caller.
 * @returns True when the host must not be fetched.
 */
export declare function isBlockedImageHost(hostname: string): boolean;
export declare function loadVerifierImages(inputs: readonly string[] | undefined, signal?: AbortSignal): Promise<VerifierImage[]>;
//# sourceMappingURL=images.d.ts.map