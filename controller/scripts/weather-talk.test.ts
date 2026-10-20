// Weather talk airs when the weather actually turns, not when the sky wavers
// between two neighbouring codes, not after every controller restart, and not
// as scenery painted from the season and the clock.

import test from 'node:test';
import assert from 'node:assert/strict';

const { conditionForCode } = await import('../src/weather-codes.js');
const { chooseCapability, resetWeatherMemory } = await import('../src/skills/_agent.js');
const { WEATHER_GROUNDING_RULE } = await import('../src/llm/internal/prompts/grounding.js');
const { djSystem } = await import('../src/llm/internal/prompts/system.js');

test('clear sky and mainly clear are one condition; showers are rain or snow, not storms (upstream weather-codes.ts)', () => {
  assert.equal(conditionForCode(0), 'clear');
  assert.equal(conditionForCode(1), 'clear');
  assert.equal(conditionForCode(2), 'cloudy');
  assert.equal(conditionForCode(3), 'cloudy');
  assert.equal(conditionForCode(45), 'foggy');
  assert.equal(conditionForCode(61), 'rainy');
  assert.equal(conditionForCode(81), 'rainy');
  assert.equal(conditionForCode(73), 'snowy');
  assert.equal(conditionForCode(86), 'snowy');
  assert.equal(conditionForCode(95), 'stormy');
});

test('the first reading after a boot is a baseline, not a change', () => {
  resetWeatherMemory();
  const caps = [{ kind: 'weather' }];
  assert.equal(chooseCapability(caps, { weather: { condition: 'cloudy' } }), null, 'boot: nothing remembered is not new weather');
  assert.equal(chooseCapability(caps, { weather: { condition: 'cloudy' } }), null);
  assert.equal(chooseCapability(caps, { weather: { condition: 'rainy' } })?.kind, 'weather');
});

test('an unknown or absent reading neither airs nor becomes the baseline', () => {
  resetWeatherMemory();
  const caps = [{ kind: 'weather' }];
  assert.equal(chooseCapability(caps, { weather: { condition: 'unknown' } }), null);
  assert.equal(chooseCapability(caps, { weather: null }), null);
  assert.equal(chooseCapability(caps, { weather: { condition: 'clear' } }), null, 'the first real reading is still the baseline');
  assert.equal(chooseCapability(caps, { weather: { condition: 'cloudy' } })?.kind, 'weather');
});

test('the simple director does not open a fresh boot with the weather', () => {
  resetWeatherMemory();
  const caps = [{ kind: 'weather' }, { kind: 'curiosity' }];
  assert.equal(chooseCapability(caps, { weather: { condition: 'cloudy' } })?.kind, 'curiosity');
  assert.equal(chooseCapability([{ kind: 'weather' }], { weather: { condition: 'cloudy' } }), null, 'unchanged weather alone is nothing to say');
  assert.equal(chooseCapability(caps, { weather: { condition: 'snowy' } })?.kind, 'weather', 'a real turn still wins');
});

test('every DJ system prompt says the season is not the weather', () => {
  assert.match(WEATHER_GROUNDING_RULE, /season and the time of day are not the weather/);
  assert.match(WEATHER_GROUNDING_RULE, /"Weather in" line/);
  assert.ok(djSystem({ name: 'Ola' }).includes(WEATHER_GROUNDING_RULE));
});
