/**
 * sigv4 — AWS Signature Version 4 for Cloudflare R2 (S3-compatible API).
 * Dependency-free: node:crypto only. Exported pure so tests pin it against
 * the AWS published test vector.
 * @module dsh-righthand/sigv4
 */

import { createHmac, createHash } from 'node:crypto'

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** URI-encode one path segment the S3 way. */
function uriEncode(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

/** Canonical URI: slashes preserved, each segment encoded. */
function canonicalPath(pathname: string): string {
  if (pathname === '' || pathname === '/') return '/'
  return pathname.split('/').map(uriEncode).join('/')
}

export interface SignRequestInput {
  method: string
  /** Full URL, e.g. https://<account>.r2.cloudflarestorage.com/<bucket>/<key> */
  url: string
  /** Headers to sign (lowercase names), e.g. host, content-type. */
  headers: Record<string, string>
  /** Exact payload bytes; '' for GET/DELETE without a body. */
  payload: string
  accessKeyId: string
  secretAccessKey: string
  /** R2 uses region 'auto'. */
  region: string
  /** yyyyMMdd'T'HHmmss'Z' — injectable for tests. */
  amzDate: string
}

export interface SignedRequest {
  headers: Record<string, string>
}

/**
 * Sign one S3 request. Returns the headers to send, including host,
 * x-amz-content-sha256, x-amz-date and Authorization.
 */
export function signRequest(input: SignRequestInput): SignedRequest {
  const parsed = new URL(input.url)
  const date = input.amzDate.slice(0, 8)
  const scope = date + '/' + input.region + '/s3/aws4_request'
  const payloadHash = sha256Hex(input.payload)

  const headers: Record<string, string> = {
    ...input.headers,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': input.amzDate,
  }
  const names = Object.keys(headers).sort()
  const canonicalHeaders = names.map(n => n + ':' + headers[n].trim() + String.fromCharCode(10)).join('')
  const signedHeaders = names.join(';')
  const canonicalRequest = [
    input.method,
    canonicalPath(parsed.pathname),
    parsed.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join(String.fromCharCode(10))
  const stringToSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, sha256Hex(canonicalRequest)].join(String.fromCharCode(10))
  const kDate = hmac('AWS4' + input.secretAccessKey, date)
  const kRegion = hmac(kDate, input.region)
  const kService = hmac(kRegion, 's3')
  const kSigning = hmac(kService, 'aws4_request')
  const signature = hmac(kSigning, stringToSign).toString('hex')
  const authorization = 'AWS4-HMAC-SHA256 Credential=' + input.accessKeyId + '/' + scope
    + ', SignedHeaders=' + signedHeaders
    + ', Signature=' + signature
  return { headers: { ...headers, authorization } }
}

/**
 * Presign a GET for query-string auth: a shareable URL valid for
 * expiresSeconds (S3 max 7 days).
 */
export function presignGet(input: Omit<SignRequestInput, 'method' | 'headers' | 'payload'> & { expiresSeconds: number }): string {
  const parsed = new URL(input.url)
  const date = input.amzDate.slice(0, 8)
  const scope = date + '/' + input.region + '/s3/aws4_request'
  const credential = input.accessKeyId + '/' + scope
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': input.amzDate,
    'X-Amz-Expires': String(input.expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  }
  const canonicalQuery = Object.keys(query).sort().map(k => uriEncode(k) + '=' + uriEncode(query[k])).join('&')
  const canonicalRequest = [
    'GET',
    canonicalPath(parsed.pathname),
    canonicalQuery,
    'host:' + parsed.host + String.fromCharCode(10),
    'host',
    'UNSIGNED-PAYLOAD',
  ].join(String.fromCharCode(10))
  const stringToSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, sha256Hex(canonicalRequest)].join(String.fromCharCode(10))
  const kDate = hmac('AWS4' + input.secretAccessKey, date)
  const kRegion = hmac(kDate, input.region)
  const kService = hmac(kRegion, 's3')
  const kSigning = hmac(kService, 'aws4_request')
  const signature = hmac(kSigning, stringToSign).toString('hex')
  parsed.search = canonicalQuery + '&X-Amz-Signature=' + signature
  return parsed.toString()
}


