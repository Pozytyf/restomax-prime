import { createHash, createHmac, randomUUID } from 'node:crypto';
import { AppError } from './errors.ts';

const BUCKET = process.env.NEON_STORAGE_BUCKET || 'restomax-media';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    '%' + char.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

export function createRestaurantImageUpload(rid: string, kind: unknown, mime: unknown, size: unknown) {
  const uploadKind = kind === 'logo' ? 'logo' : kind === 'menu' ? 'menu' : null;
  const contentType = typeof mime === 'string' ? mime.toLowerCase() : '';
  const contentLength = Number(size);
  if (!uploadKind || !ALLOWED_TYPES.has(contentType)) {
    throw new AppError(400, 'Format image invalide. Utilisez JPG, PNG ou WebP.');
  }
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_UPLOAD_BYTES) {
    throw new AppError(400, 'Image trop volumineuse (maximum 5 Mo).');
  }

  const endpoint = process.env.AWS_ENDPOINT_URL_S3;
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || 'eu-central-1';
  if (!endpoint || !accessKey || !secretKey) {
    throw new AppError(503, 'Stockage images non configuré sur le serveur.');
  }

  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== 'https:' || endpointUrl.pathname !== '/' || endpointUrl.search) {
    throw new AppError(500, 'Endpoint de stockage Neon invalide.');
  }
  const ext = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : 'webp';
  const key = `${rid}/${uploadKind}/${randomUUID()}.${ext}`;
  const encodedPath = '/' + [BUCKET, ...key.split('/')].map(awsEncode).join('/');
  const host = endpointUrl.host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': '300',
    'X-Amz-SignedHeaders': 'content-type;host',
  };
  const canonicalQuery = Object.entries(params)
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as const)
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
    .map(([k, v]) => `${k}=${v}`).join('&');
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const canonicalRequest = ['PUT', encodedPath, canonicalQuery, canonicalHeaders, 'content-type;host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const dateKey = hmac('AWS4' + secretKey, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const uploadUrl = `${endpointUrl.origin}${encodedPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  const publicUrl = `${endpointUrl.origin}${encodedPath}`;
  return { key, uploadUrl, publicUrl, method: 'PUT' as const, contentType, maxBytes: MAX_UPLOAD_BYTES };
}

export function isRestaurantImageUrl(rid: string, kind: 'menu' | 'logo', value: unknown): value is string {
  if (typeof value !== 'string' || !process.env.AWS_ENDPOINT_URL_S3) return false;
  const endpoint = process.env.AWS_ENDPOINT_URL_S3.endsWith('/') ? process.env.AWS_ENDPOINT_URL_S3.slice(0, -1) : process.env.AWS_ENDPOINT_URL_S3;
  const expectedPrefix = `${endpoint}/${BUCKET}/${rid}/${kind}/`;
  return value.startsWith(expectedPrefix) && !value.includes('..');
}
