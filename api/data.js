const { Redis } = require('@upstash/redis');
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5) + 1;

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      const events = Object.values((await redis.hgetall('events')) || {});
      const responses = [];
      for (const e of events) responses.push(...Object.values((await redis.hgetall('resp:' + e.id)) || {}));
      return res.status(200).json({ events, responses });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const b = req.body || {};
    const admin = !!process.env.ADMIN_PASSWORD && req.headers['x-admin-key'] === process.env.ADMIN_PASSWORD;

    if (b.action === 'login') return admin ? res.status(200).json({ ok: true }) : res.status(401).json({ error: 'Unauthorized' });

    if (b.action === 'createEvent') {
      if (!admin) return res.status(401).json({ error: 'Unauthorized' });
      const name = String(b.name || '').trim().slice(0, 60);
      const d = parseInt(b.days);
      if (!name || !isDate(b.start) || !isDate(b.end) || b.end < b.start || !(d >= 1 && d <= 30))
        return res.status(400).json({ error: 'Data event tidak valid' });
      const range = days(b.start, b.end);
      if (range < d || range > 366) return res.status(400).json({ error: 'Rentang tanggal tidak valid' });
      const id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      await redis.hset('events', { [id]: { id, name, start: b.start, end: b.end, days: d } });
      return res.status(200).json({ ok: true, id });
    }

    if (b.action === 'deleteEvent') {
      if (!admin) return res.status(401).json({ error: 'Unauthorized' });
      if (!/^[a-z0-9]{2,40}$/.test(b.id || '')) return res.status(400).json({ error: 'ID tidak valid' });
      await redis.hdel('events', b.id);
      await redis.del('resp:' + b.id);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'save') {
      const ev = await redis.hget('events', b.eventId);
      if (!ev) return res.status(404).json({ error: 'Event tidak ditemukan' });
      const name = String(b.name || '').trim().slice(0, 40);
      const id = String(b.id || '');
      if (!name || !/^[a-z0-9_]{3,100}$/.test(id) || !id.startsWith(ev.id + '_'))
        return res.status(400).json({ error: 'Data tidak valid' });
      const dates = Array.isArray(b.dates) ? [...new Set(b.dates)].filter(x => isDate(x) && x >= ev.start && x <= ev.end).slice(0, 400) : [];
      await redis.hset('resp:' + ev.id, { [id]: { id, eventId: ev.id, name, dates } });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Aksi tidak dikenal' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
};
