const express = require('express');
const Redis = require('ioredis');
const { Pool } = require('pg');
const pool = new Pool();
const redis = new Redis();
const app = express();
app.use(express.json());

app.post('/send', async (req, res) => {
    const { from, to, content } = req.body;
    // 1. Persist to DB for monotonic order and history
    const dbRes = await pool.query('INSERT INTO messages (sender, receiver, content, status) VALUES ($1, $2, $3, $4) RETURNING id', [from, to, content, 'sent']);
    const msgId = dbRes.rows[0].id;

    // 2. Check presence
    const isOnline = await redis.get(`presence:${to}`);
    if (isOnline) {
        // Push via websockets/pubsub
        redis.publish('chat', JSON.stringify({ to, msgId, content }));
    } else {
        // 3. Offline Mailbox Queue buffer
        await redis.lpush(`offline_queue:${to}`, JSON.stringify({ msgId, content }));
    }
    res.json({ msgId, status: 'sent' });
});

app.post('/connect/:userId', async (req, res) => {
    await redis.set(`presence:${req.params.userId}`, 'online');
    // Flush offline queue instantly
    const offlineMessages = await redis.lrange(`offline_queue:${req.params.userId}`, 0, -1);
    await redis.del(`offline_queue:${req.params.userId}`);
    res.json({ pending: offlineMessages.map(JSON.parse) });
});
if (require.main === module) {
    app.listen(3000, () => console.log('Chat API on port 3000'));
}
module.exports = { app, pool, redis };
