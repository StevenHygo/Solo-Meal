import type { Coordinate, CoordinateType } from '../domain/types.js';

const PI = Math.PI;
const AXIS = 6378245;
const ECCENTRICITY = 0.006693421622965943;

function outsideChina({ lat, lng }: Coordinate): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(lng: number, lat: number): number {
  let value = -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
  value += (20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2 / 3;
  value += (20 * Math.sin(lat * PI) + 40 * Math.sin(lat / 3 * PI)) * 2 / 3;
  value += (160 * Math.sin(lat / 12 * PI) + 320 * Math.sin(lat * PI / 30)) * 2 / 3;
  return value;
}

function transformLng(lng: number, lat: number): number {
  let value = 300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
  value += (20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2 / 3;
  value += (20 * Math.sin(lng * PI) + 40 * Math.sin(lng / 3 * PI)) * 2 / 3;
  value += (150 * Math.sin(lng / 12 * PI) + 300 * Math.sin(lng / 30 * PI)) * 2 / 3;
  return value;
}

export function wgs84ToGcj02(coordinate: Coordinate): Coordinate {
  if (outsideChina(coordinate)) return { ...coordinate };

  let latitudeDelta = transformLat(coordinate.lng - 105, coordinate.lat - 35);
  let longitudeDelta = transformLng(coordinate.lng - 105, coordinate.lat - 35);
  const radianLatitude = coordinate.lat / 180 * PI;
  let magic = Math.sin(radianLatitude);
  magic = 1 - ECCENTRICITY * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  latitudeDelta = latitudeDelta * 180 / ((AXIS * (1 - ECCENTRICITY)) / (magic * sqrtMagic) * PI);
  longitudeDelta = longitudeDelta * 180 / (AXIS / sqrtMagic * Math.cos(radianLatitude) * PI);
  return { lat: coordinate.lat + latitudeDelta, lng: coordinate.lng + longitudeDelta };
}

export function gcj02ToWgs84(coordinate: Coordinate): Coordinate {
  if (outsideChina(coordinate)) return { ...coordinate };
  const projected = wgs84ToGcj02(coordinate);
  return {
    lat: coordinate.lat * 2 - projected.lat,
    lng: coordinate.lng * 2 - projected.lng
  };
}

export function normalizeToWgs84(coordinate: Coordinate, type: CoordinateType): Coordinate {
  return type === 'gcj02' ? gcj02ToWgs84(coordinate) : { ...coordinate };
}
