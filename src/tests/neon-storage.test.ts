import test from 'node:test';
import assert from 'node:assert/strict';
import { createRestaurantImageUpload, isRestaurantImageUrl } from '../server/services/neonStorage.ts';

test('Neon image upload URL is scoped to a restaurant and a public media bucket', () => {
  const original = {
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    accessKey: process.env.AWS_ACCESS_KEY_ID,
    secretKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
    bucket: process.env.NEON_STORAGE_BUCKET,
  };
  process.env.AWS_ENDPOINT_URL_S3 = 'https://br-test.storage.c-8.eu-central-1.aws.neon.tech';
  process.env.AWS_ACCESS_KEY_ID = 'nak_test_access';
  process.env.AWS_SECRET_ACCESS_KEY = 'nsk_test_secret';
  process.env.AWS_REGION = 'eu-central-1';
  process.env.NEON_STORAGE_BUCKET = 'restomax-media';

  try {
    const upload = createRestaurantImageUpload('rest_test', 'menu', 'image/png', 1024);
    const signed = new URL(upload.uploadUrl);
    assert.equal(upload.method, 'PUT');
    assert.equal(upload.publicUrl, `https://br-test.storage.c-8.eu-central-1.aws.neon.tech/restomax-media/${upload.key}`);
    assert.equal(signed.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
    assert.equal(signed.searchParams.get('X-Amz-SignedHeaders'), 'content-type;host');
    assert.match(signed.searchParams.get('X-Amz-Signature') || '', /^[a-f0-9]{64}$/);
    assert.equal(isRestaurantImageUrl('rest_test', 'menu', upload.publicUrl), true);
    assert.equal(isRestaurantImageUrl('other_restaurant', 'menu', upload.publicUrl), false);
    assert.equal(isRestaurantImageUrl('rest_test', 'logo', upload.publicUrl), false);
  } finally {
    if (original.endpoint === undefined) delete process.env.AWS_ENDPOINT_URL_S3;
    else process.env.AWS_ENDPOINT_URL_S3 = original.endpoint;
    if (original.accessKey === undefined) delete process.env.AWS_ACCESS_KEY_ID;
    else process.env.AWS_ACCESS_KEY_ID = original.accessKey;
    if (original.secretKey === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
    else process.env.AWS_SECRET_ACCESS_KEY = original.secretKey;
    if (original.region === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = original.region;
    if (original.bucket === undefined) delete process.env.NEON_STORAGE_BUCKET;
    else process.env.NEON_STORAGE_BUCKET = original.bucket;
  }
});

test('Neon image upload rejects unsupported MIME types and oversized files', () => {
  const original = {
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    accessKey: process.env.AWS_ACCESS_KEY_ID,
    secretKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
  process.env.AWS_ENDPOINT_URL_S3 = 'https://br-test.storage.c-8.eu-central-1.aws.neon.tech';
  process.env.AWS_ACCESS_KEY_ID = 'nak_test_access';
  process.env.AWS_SECRET_ACCESS_KEY = 'nsk_test_secret';
  try {
    assert.throws(() => createRestaurantImageUpload('rest_test', 'menu', 'image/svg+xml', 1024));
    assert.throws(() => createRestaurantImageUpload('rest_test', 'logo', 'image/png', 6 * 1024 * 1024));
  } finally {
    if (original.endpoint === undefined) delete process.env.AWS_ENDPOINT_URL_S3;
    else process.env.AWS_ENDPOINT_URL_S3 = original.endpoint;
    if (original.accessKey === undefined) delete process.env.AWS_ACCESS_KEY_ID;
    else process.env.AWS_ACCESS_KEY_ID = original.accessKey;
    if (original.secretKey === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
    else process.env.AWS_SECRET_ACCESS_KEY = original.secretKey;
  }
});
