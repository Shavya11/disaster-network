import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { earthquakeH, fireH, heatH, rainH, scoreIncident, tierForScore, windH, type Contributor } from './severity.js';

const close = (actual: number, expected: number, eps = 0.005) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ≈${expected}, got ${actual}`);

const report = (id: string, opts: Partial<Extract<Contributor, { kind: 'report' }>> = {}): Contributor => ({
  kind: 'report',
  id,
  hazard_type: 'BUILDING_COLLAPSE',
  occurred_at: new Date('2026-02-10T06:30:00Z'), // 12:00 IST, outside monsoon
  lon: 72.88,
  has_photo: false,
  reporter_trusted: false,
  people_affected: null,
  ...opts,
});

const base = {
  verified: false,
  tier_override: null,
  density_per_km2: 8000,
  density_basis: 'test',
  users_in_area: 0,
};

describe('hazard intensity (Severity-Model §3)', () => {
  it('maps IMD rainfall bands', () => {
    assert.equal(rainH(10), 0);
    assert.equal(rainH(30), 0.1);
    assert.equal(rainH(64.5), 0.35);
    assert.equal(rainH(142), 0.65);
    assert.equal(rainH(250), 0.95);
  });

  it('maps IMD cyclone wind bands', () => {
    assert.equal(windH(40), 0.15);
    assert.equal(windH(100), 0.6);
    assert.equal(windH(250), 1);
  });

  it('interpolates magnitude and applies depth factor', () => {
    close(earthquakeH(5.0, 10), 0.35);
    close(earthquakeH(5.5, 10), 0.475);
    close(earthquakeH(6.0, 150), 0.6 * 0.55);
    close(earthquakeH(7.0, 400), 0.85 * 0.3);
    assert.equal(earthquakeH(3, 5), 0.05);
  });

  it('maps FIRMS fire radiative power', () => {
    assert.equal(fireH(5), 0.15);
    assert.equal(fireH(30), 0.35);
    assert.equal(fireH(120), 0.65);
    assert.equal(fireH(250), 0.9);
  });

  it('maps IMD heatwave criteria', () => {
    assert.equal(heatH(39), 0);
    assert.equal(heatH(45.5), 0.55);
    assert.equal(heatH(47), 0.85);
  });
});

describe('confidence (Severity-Model §4.3, noisy-OR)', () => {
  const C = (cs: Contributor[]) => scoreIncident({ ...base, hazard_type: 'BUILDING_COLLAPSE', contributors: cs }).C;

  it('matches the documented examples', () => {
    close(C([report('a')]), 0.3);
    close(C([report('a'), report('b')]), 0.51);
    close(C([report('a'), report('b'), report('c', { has_photo: true })]), 0.73);
  });

  it('is 1 once a coordinator verifies', () => {
    const b = scoreIncident({ ...base, verified: true, hazard_type: 'BUILDING_COLLAPSE', contributors: [report('a')] });
    assert.equal(b.C, 1);
    assert.equal(b.alert_permission, 'EMERGENCY');
  });
});

describe('score and permission', () => {
  const rain: Contributor = {
    kind: 'signal',
    id: '1',
    source: 'open-meteo',
    hazard_type: 'FLOOD',
    magnitude: 142,
    occurred_at: new Date('2026-08-10T18:30:00Z'),
    lon: 72.88,
    payload: { unit: 'mm', forecast_date: '2026-08-11' },
  };

  it('scores official heavy rain in a city during monsoon', () => {
    const b = scoreIncident({ ...base, hazard_type: 'FLOOD', contributors: [rain] });
    // H 0.65, E log10(8001)/log10(20001) = 0.908, V monsoon 0.10, C 0.95
    close(b.H, 0.65);
    close(b.E, 0.908);
    close(b.V, 0.1);
    close(b.C, 0.95);
    close(b.score, 100 * (0.55 * 0.65 + 0.3 * 0.908 + 0.15 * 0.1) * 0.95, 0.05);
    assert.equal(b.tier, 'WARNING');
    assert.equal(b.alert_permission, 'WARNING');
  });

  it('never lets a single unverified citizen report authorise an alert', () => {
    const b = scoreIncident({ ...base, hazard_type: 'BUILDING_COLLAPSE', contributors: [report('a')] });
    assert.equal(b.alert_permission, 'INFO');
    assert.ok(b.score < 25);
  });

  it('allows WATCH once citizen reports corroborate', () => {
    const b = scoreIncident({
      ...base,
      hazard_type: 'BUILDING_COLLAPSE',
      contributors: [report('a'), report('b'), report('c')],
    });
    assert.equal(b.alert_permission, 'WATCH');
  });

  it('respects a coordinator tier override', () => {
    const b = scoreIncident({ ...base, verified: true, tier_override: 'EMERGENCY', hazard_type: 'FLOOD', contributors: [rain] });
    assert.equal(b.tier, 'EMERGENCY');
    assert.equal(b.computed_tier, 'WARNING');
  });

  it('uses documented tier bands', () => {
    assert.equal(tierForScore(24.9), 'INFO');
    assert.equal(tierForScore(25), 'WATCH');
    assert.equal(tierForScore(50), 'WARNING');
    assert.equal(tierForScore(75), 'EMERGENCY');
  });
});
