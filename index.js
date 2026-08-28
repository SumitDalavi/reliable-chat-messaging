const express = require('express');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const app = express();
app.use(express.json());

let db;

async function initDb(dbPath = ':memory:') {
    db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            seq_id INTEGER PRIMARY KEY AUTOINCREMENT,
            idempotency_key TEXT UNIQUE,
            sender TEXT,
            receiver TEXT,
            content TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS consumer_offsets (
            user_id TEXT PRIMARY KEY,
            last_seq_id INTEGER DEFAULT 0
        );
    `);
}

app.post('/send', async (req, res) => {
    const { idempotencyKey, from, to, content } = req.body;
    
    if (!idempotencyKey || !from || !to || !content) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // 1. Strict Duplicate Handling & Ordering (Monotonic Sequence ID via AUTOINCREMENT)
        const result = await db.run(
            'INSERT INTO messages (idempotency_key, sender, receiver, content) VALUES (?, ?, ?, ?)',
            [idempotencyKey, from, to, content]
        );
        
        res.json({ seqId: result.lastID, status: 'sent' });
    } catch (e) {
        if (e.message.includes('UNIQUE constraint failed')) {
            // Idempotent recovery: return the existing message's sequence ID
            const existing = await db.get('SELECT seq_id FROM messages WHERE idempotency_key = ?', [idempotencyKey]);
            return res.json({ seqId: existing.seq_id, status: 'duplicate_acknowledged' });
        }
        res.status(500).json({ error: e.message });
    }
});

app.post('/sync/:userId', async (req, res) => {
    const { userId } = req.params;
    const { clientOffset } = req.body; // The last sequence ID the client successfully processed

    try {
        // 1. Get server's known offset for this user (if client doesn't provide one, fallback to server's)
        let offsetRow = await db.get('SELECT last_seq_id FROM consumer_offsets WHERE user_id = ?', [userId]);
        if (!offsetRow) {
            await db.run('INSERT INTO consumer_offsets (user_id, last_seq_id) VALUES (?, 0)', [userId]);
            offsetRow = { last_seq_id: 0 };
        }

        const effectiveOffset = clientOffset !== undefined ? clientOffset : offsetRow.last_seq_id;

        // 2. Fetch all messages strictly AFTER the effective offset (FIFO Order)
        const messages = await db.all(
            'SELECT seq_id, sender, content, timestamp FROM messages WHERE receiver = ? AND seq_id > ? ORDER BY seq_id ASC',
            [userId, effectiveOffset]
        );

        res.json({ messages, nextOffset: messages.length > 0 ? messages[messages.length - 1].seq_id : effectiveOffset });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/commit/:userId', async (req, res) => {
    const { userId } = req.params;
    const { seqId } = req.body;

    if (seqId === undefined) {
        return res.status(400).json({ error: 'seqId is required' });
    }

    try {
        // Consumer explicitly commits their offset after processing the sync batch
        await db.run(
            'INSERT INTO consumer_offsets (user_id, last_seq_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_seq_id = ?',
            [userId, seqId, seqId]
        );
        res.json({ success: true, committedOffset: seqId });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

if (require.main === module) {
    initDb('chat.db').then(() => {
        app.listen(3000, () => console.log('Chat API on port 3000'));
    });
}

module.exports = { app, initDb, getDb: () => db };
