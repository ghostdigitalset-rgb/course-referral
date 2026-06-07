import { Redis } from '@upstash/redis';

let redis;

function getRedis() {
  if (!redis) {
    redis = new Redis({
      url: process.env.STORAGE_URL,
      token: process.env.STORAGE_TOKEN,
    });
  }
  return redis;
}

export async function getData() {
  try {
    const r = getRedis();
    const data = await r.get('app-data');
    if (!data) return { reps: [], students: [] };
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) {
    console.error('getData error:', e);
    return { reps: [], students: [] };
  }
}

export async function setData(data) {
  try {
    const r = getRedis();
    await r.set('app-data', JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('setData error:', e);
    return false;
  }
}
