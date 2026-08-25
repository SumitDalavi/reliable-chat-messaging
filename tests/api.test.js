const request = require('supertest');

jest.mock('pg', () => {
    const mPool = {
        query: jest.fn(),
    };
    return { Pool: jest.fn(() => mPool) };
});

jest.mock('ioredis', () => {
    const EventEmitter = require('events');
    class MockRedis extends EventEmitter {
        constructor() {
            super();
            this.store = {};
            this.lists = {};
        }
        async get(k) { return this.store[k]; }
        async set(k, v) { this.store[k] = v; }
        async del(k) { delete this.store[k]; delete this.lists[k]; }
        async publish(c, m) { this.emit('message', c, m); }
        async lpush(k, v) {
            if (!this.lists[k]) this.lists[k] = [];
            this.lists[k].unshift(v);
        }
        async lrange(k, s, e) {
            return this.lists[k] || [];
        }
        quit() {}
    }
    return jest.fn(() => new MockRedis());
});

const { app, pool, redis } = require('../index');

describe('Reliable Chat Messaging', () => {
    afterAll(async () => {
        await redis.quit();
    });

    it('should queue message if offline', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id: 10 }] });

        const res = await request(app).post('/send').send({
            from: 'alice',
            to: 'bob',
            content: 'Hello'
        });

        expect(res.statusCode).toEqual(200);
        expect(res.body.msgId).toEqual(10);
        expect(res.body.status).toEqual('sent');

        const queue = await redis.lrange('offline_queue:bob', 0, -1);
        expect(queue.length).toEqual(1);
    });

    it('should flush pending on connect', async () => {
        // Alice connects
        const res = await request(app).post('/connect/bob');
        expect(res.statusCode).toEqual(200);
        expect(res.body.pending.length).toBeGreaterThanOrEqual(1);
        expect(res.body.pending[0].msgId).toEqual(10);

        // Queue should be cleared
        const queueAfter = await redis.lrange('offline_queue:bob', 0, -1);
        expect(queueAfter.length).toEqual(0);
    });
});
