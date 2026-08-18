const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
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
        const response = await fetch(url, { redirect: 'error', signal });
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