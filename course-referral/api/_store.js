// Vercel KV-based data store
// Uses @vercel/kv which is available as an env variable VERCEL_KV_*

let kv;

async function getKV() {
  if (!kv) {
    const { createClient } = await import('@vercel/kv');
    kv = createClient({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return kv;
}

export async function getData() {
  try {
    const store = await getKV();
    const data = await store.get('app-data');
    if (!data) return { reps: [], students: [] };
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) {
    console.error('getData error:', e);
    return { reps: [], students: [] };
  }
}

export async function setData(data) {
  try {
    const store = await getKV();
    await store.set('app-data', JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('setData error:', e);
    return false;
  }
}
