import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { cities, cuisineCategories } from '../src/catalog.js';
import { v0Restaurants } from '../src/fixtures/v0-restaurants.js';

async function importBrowserModule(file: string): Promise<Record<string, unknown>> {
  const source = await readFile(file, 'utf8');
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(url) as Promise<Record<string, unknown>>;
}

test('server catalog matches the browser cuisine and coverage registries', async () => {
  const web = await importBrowserModule(path.resolve('..', 'web', 'config.js'));
  const webCuisines = web.cuisineCategories as Array<{ code: string; label: string; icon: string }>;
  const webCities = web.cities as Array<{ code: string; areas: Array<{ code: string; status: string }> }>;
  assert.deepEqual(webCuisines.map(item => item.code), cuisineCategories.map(item => item.code));
  assert.deepEqual(webCuisines.map(item => item.label), cuisineCategories.map(item => item.label));
  assert.deepEqual(webCuisines.map(item => item.icon.split('/').at(-1)?.replace('.svg', '')), cuisineCategories.map(item => item.iconKey));
  assert.deepEqual(webCities.map(item => item.code), cities.map(item => item.code));
  assert.deepEqual(webCities.flatMap(item => item.areas.map(area => [area.code, area.status])), cities.flatMap(item => item.areas.map(area => [area.id, area.status])));
});

test('database fixture preserves v0 identity and user-visible core fields', async () => {
  const web = await importBrowserModule(path.resolve('..', 'web', 'data.js'));
  const webRestaurants = web.restaurants as Array<{
    id: string; name: string; cuisineCode: string; cityCode: string; coverageAreaCode: string;
    priceMin: number; priceMax: number; latitude: number; longitude: number;
  }>;
  assert.equal(webRestaurants.length, 6);
  assert.deepEqual(webRestaurants.map(item => item.id), v0Restaurants.map(item => item.legacyId));
  for (const browserRestaurant of webRestaurants) {
    const serverRestaurant = v0Restaurants.find(item => item.legacyId === browserRestaurant.id);
    assert.ok(serverRestaurant);
    assert.equal(serverRestaurant.name, browserRestaurant.name);
    assert.equal(serverRestaurant.primaryCuisineCode, browserRestaurant.cuisineCode);
    assert.equal(serverRestaurant.cityCode, browserRestaurant.cityCode);
    assert.equal(serverRestaurant.coverageAreaId, browserRestaurant.coverageAreaCode);
    assert.equal(serverRestaurant.priceMinFen, browserRestaurant.priceMin * 100);
    assert.equal(serverRestaurant.priceMaxFen, browserRestaurant.priceMax * 100);
    assert.deepEqual(serverRestaurant.sourceLocation, { lat: browserRestaurant.latitude, lng: browserRestaurant.longitude });
  }
});
