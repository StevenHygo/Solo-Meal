#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const defaults = {
  coverageAreaId: 'sh-jingan-huangpu',
  provider: 'public_source',
  apiUrl: '',
  token: '',
  operatorId: ''
};

function usage() {
  return [
    'Usage:',
    '  node scripts/prepare-public-poi-import.mjs <input.json> [--api-url http://127.0.0.1:8787] [--token TOKEN] [--operator-id ID]',
    '',
    'Input must contain source_label, authorization_basis, and 1-50 candidates from public or licensed sources.'
  ].join('\n');
}

function parseArgs(argv) {
  const options = { ...defaults, inputPath: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--') && !options.inputPath) {
      options.inputPath = arg;
      continue;
    }
    const value = argv[index + 1];
    if (arg === '--coverage-area') options.coverageAreaId = value;
    else if (arg === '--provider') options.provider = value;
    else if (arg === '--api-url') options.apiUrl = value;
    else if (arg === '--token') options.token = value;
    else if (arg === '--operator-id') options.operatorId = value;
    else throw new Error(`Unknown argument: ${arg}`);
    index += 1;
  }
  if (!options.inputPath) throw new Error(usage());
  return options;
}

function assertText(value, name, min, max) {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new Error(`${name} must be ${min}-${max} characters`);
  return trimmed;
}

function stableUuid(value) {
  const bytes = createHash('sha256').update(value).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function providerPoiId(candidate) {
  if (candidate.provider_poi_id) return assertText(candidate.provider_poi_id, 'provider_poi_id', 1, 128);
  const identity = [
    candidate.source_url || '',
    candidate.name || '',
    candidate.address || ''
  ].join('|');
  return `public-${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

function normalizeCandidate(candidate, index, observedAt) {
  const location = candidate.location ?? candidate;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  const coordType = location.coord_type || candidate.coord_type || 'wgs84';
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error(`candidate ${index + 1} has invalid lat`);
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error(`candidate ${index + 1} has invalid lng`);
  if (coordType !== 'wgs84' && coordType !== 'gcj02') throw new Error(`candidate ${index + 1} coord_type must be wgs84 or gcj02`);

  return {
    provider_poi_id: providerPoiId(candidate),
    name: assertText(candidate.name, `candidate ${index + 1} name`, 1, 160),
    address: assertText(candidate.address, `candidate ${index + 1} address`, 1, 300),
    district: assertText(candidate.district || '静安 / 黄浦', `candidate ${index + 1} district`, 1, 80),
    location: { lat, lng, coord_type: coordType },
    ...(candidate.phone ? { phone: String(candidate.phone).trim() } : {}),
    ...(candidate.raw_category ? { raw_category: String(candidate.raw_category).trim() } : {}),
    observed_at: candidate.observed_at || observedAt
  };
}

function normalizeInput(raw, options) {
  const candidates = Array.isArray(raw) ? raw : raw.candidates;
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 50) {
    throw new Error('input must contain 1-50 candidates');
  }
  const sourceLabel = assertText(raw.source_label || '公开来源候选', 'source_label', 1, 120);
  const authorizationBasis = assertText(raw.authorization_basis, 'authorization_basis', 10, 500);
  const observedAt = raw.observed_at || new Date().toISOString();
  const payloadWithoutKey = {
    coverage_area_id: raw.coverage_area_id || options.coverageAreaId,
    provider: raw.provider || options.provider,
    source_label: sourceLabel,
    authorization_basis: authorizationBasis,
    candidates: candidates.map((candidate, index) => normalizeCandidate(candidate, index, observedAt))
  };
  return {
    ...payloadWithoutKey,
    idempotency_key: raw.idempotency_key || stableUuid(JSON.stringify(payloadWithoutKey))
  };
}

async function postPayload(payload, options) {
  if (!options.token || !options.operatorId) throw new Error('--token and --operator-id are required with --api-url');
  const baseUrl = options.apiUrl.replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/api/v1/admin/poi/imports`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.token}`,
      'x-operator-id': options.operatorId,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body, null, 2));
  return body;
}

const options = parseArgs(process.argv.slice(2));
const raw = JSON.parse(await readFile(options.inputPath, 'utf8'));
const payload = normalizeInput(raw, options);

if (options.apiUrl) {
  console.log(JSON.stringify(await postPayload(payload, options), null, 2));
} else {
  console.log(JSON.stringify(payload, null, 2));
}
