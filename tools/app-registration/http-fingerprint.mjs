#!/usr/bin/env node

/**
 * Request-body fingerprint and retry-after helpers shared by the HTTP clients.
 *
 * # Why the body hash is mandatory
 *
 * The SDKWork idempotency middleware (`sdkwork-web-framework`
 * `crates/sdkwork-web-core/src/idempotency.rs`
 * `resolve_idempotency_fingerprint`, reached from
 * `crates/sdkwork-web-core/src/interceptors.rs` `StandardWebCallInterceptorKind::Idempotency`)
 * refuses an idempotent command that carries a body unless the request names the
 * body's digest:
 *
 * > requests with a body must include X-Content-SHA256 or
 * > X-Idempotency-Fingerprint for idempotent commands
 *
 * An `Idempotency-Key` alone is not enough: the key identifies the retry slot,
 * the fingerprint identifies the payload inside it. Without the header Deploy
 * answers `400`, which is what the first real rehearsal hit on `apps.create`.
 *
 * `X-Content-SHA256` is the lowercase hex SHA-256 of the **exact bytes sent as
 * the request body**, which is the same value
 * `@sdkwork/sdk-common` `BaseHttpClient.applySdkworkRequestBodyFingerprint`
 * computes from `JSON.stringify(body)` encoded as UTF-8.
 *
 * @module app-registration/http-fingerprint
 */

import { createHash } from 'node:crypto';

/** Header the idempotency middleware reads for the body digest. */
export const CONTENT_SHA256_HEADER = 'x-content-sha256';

/** Lowercase hex SHA-256 of the bytes handed to the transport. */
export function sha256Hex(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Serialize a request body exactly once.
 *
 * Serializing once matters: the digest must describe the bytes that are sent, so
 * the same string is hashed and passed to `fetch`. Re-serializing the object
 * later could produce different bytes (key order is stable for the same object,
 * but a proxy/serializer change would desynchronize the two).
 * @param body - request body object, or `undefined` when the request has none
 * @returns the serialized JSON text, or `undefined`
 */
export function serializeRequestBody(body) {
  return body === undefined ? undefined : JSON.stringify(body);
}

/**
 * Headers that declare a body and its digest.
 * @param serialized - output of {@link serializeRequestBody}
 * @returns header pairs to merge into the request
 */
export function bodyFingerprintHeaders(serialized) {
  if (serialized === undefined) {
    return {};
  }
  return {
    'content-type': 'application/json',
    [CONTENT_SHA256_HEADER]: sha256Hex(serialized),
  };
}

/**
 * Read `Retry-After` as a millisecond delay.
 *
 * RFC 9110 allows either a whole number of seconds or an HTTP-date. A value the
 * parser cannot read yields `0`, which lets the caller fall back to its own
 * exponential backoff instead of waiting forever on a malformed header.
 * @param rawValue - header value
 * @param nowMs - clock injection point for tests
 * @returns non-negative delay in milliseconds
 */
export function parseRetryAfterMs(rawValue, nowMs = Date.now()) {
  const value = String(rawValue ?? '').trim();
  if (!value) {
    return 0;
  }
  if (/^[0-9]+$/u.test(value)) {
    return Number(value) * 1000;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return 0;
  }
  return Math.max(0, timestamp - nowMs);
}
