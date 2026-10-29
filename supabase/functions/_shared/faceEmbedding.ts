// Shared face-embedding pipeline used for BOTH sketches and suspects.
// Sketches and suspects must use the exact same vision prompt + embedding model,
// otherwise their vectors live in different spaces and similarity is ~0.

export const EMBEDDING_DIMENSIONS = 768;
export const EMBEDDING_MODEL = 'google/gemini-embedding-001';
const VISION_MODEL = 'google/gemini-2.5-flash';
const GATEWAY = 'https://ai.gateway.lovable.dev/v1';

const VISION_PROMPT =
  'Analyze this forensic sketch or suspect photo in extreme detail. Describe all facial features, characteristics, distinctive marks, expressions, age, gender, hair, eyes, nose, mouth, face shape, skin tone, and any other identifying features. Be comprehensive and precise for forensic matching purposes.';

const gatewayHeaders = (key: string) => ({
  'Authorization': `Bearer ${key}`,
  'Lovable-API-Key': key,
  'Content-Type': 'application/json',
});

export const blobToDataUrl = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
};

export const describeFace = async (imageUrl: string, apiKey: string): Promise<string> => {
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: 'POST',
    headers: gatewayHeaders(apiKey),
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('Vision API error:', res.status, t);
    throw new Error(`Failed to analyze image (status ${res.status})`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('No description returned from vision model');
  return text;
};

export const embedText = async (text: string, apiKey: string): Promise<number[]> => {
  const res = await fetch(`${GATEWAY}/embeddings`, {
    method: 'POST',
    headers: gatewayHeaders(apiKey),
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text, dimensions: EMBEDDING_DIMENSIONS }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('Embedding API error:', res.status, t);
    throw new Error(`Failed to generate embedding (status ${res.status})`);
  }
  const data = await res.json();
  const raw = data.data?.[0]?.embedding;
  if (!Array.isArray(raw) || raw.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Invalid embedding returned (length ${raw?.length})`);
  }
  const vec = raw.map(Number);
  if (vec.some(Number.isNaN) || vec.every((v) => v === 0)) throw new Error('Invalid embedding values');
  return vec;
};
