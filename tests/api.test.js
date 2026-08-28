const request = require('supertest');
const { app, initDb, getDb } = require('../index');

describe('Reliable Chat Messaging', () => {
    beforeAll(async () => {
        await initDb(':memory:');
    });

    beforeEach(async () => {
        const db = getDb();
        await db.run('DELETE FROM messages');
        await db.run('DELETE FROM consumer_offsets');
    });

    it('should send a message and assign a monotonic sequence ID', async () => {
        const res = await request(app).post('/send').send({
            idempotencyKey: 'msg123',
            from: 'alice',
            to: 'bob',
            content: 'Hello Bob!'
        });
        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('sent');
        expect(res.body.seqId).toBeDefined();
        
        // Second message should have a strictly greater seqId
        const res2 = await request(app).post('/send').send({
            idempotencyKey: 'msg124',
            from: 'alice',
            to: 'bob',
            content: 'How are you?'
        });
        expect(res2.body.seqId).toBeGreaterThan(res.body.seqId);
    });

    it('should strictly handle duplicate messages idempotently', async () => {
        const reqPayload = {
            idempotencyKey: 'msg_duplicate_test',
            from: 'alice',
            to: 'bob',
            content: 'Network retry'
        };

        const res1 = await request(app).post('/send').send(reqPayload);
        expect(res1.statusCode).toBe(200);
        expect(res1.body.status).toBe('sent');

        // Simulate network retry with exactly the same idempotency key
        const res2 = await request(app).post('/send').send(reqPayload);
        expect(res2.statusCode).toBe(200);
        expect(res2.body.status).toBe('duplicate_acknowledged');
        
        // Ensure both returned the EXACT SAME sequence ID
        expect(res2.body.seqId).toBe(res1.body.seqId);
    });

    it('should sync missed messages using consumer offsets in strict FIFO order', async () => {
        // Alice sends 3 messages to Bob
        for (let i = 1; i <= 3; i++) {
            await request(app).post('/send').send({
                idempotencyKey: `msg_${i}`,
                from: 'alice',
                to: 'bob',
                content: `Message ${i}`
            });
        }

        // Bob syncs from beginning (offset 0)
        const sync1 = await request(app).post('/sync/bob').send({ clientOffset: 0 });
        expect(sync1.statusCode).toBe(200);
        expect(sync1.body.messages.length).toBe(3);
        
        // The nextOffset should be the seqId of the 3rd message
        const lastSeqId = sync1.body.nextOffset;
        expect(lastSeqId).toBeDefined();

        // Bob commits his offset
        const commitRes = await request(app).post('/commit/bob').send({ seqId: lastSeqId });
        expect(commitRes.statusCode).toBe(200);
        expect(commitRes.body.committedOffset).toBe(lastSeqId);

        // Bob syncs again without explicitly passing clientOffset, should use server offset
        const sync2 = await request(app).post('/sync/bob').send({});
        expect(sync2.body.messages.length).toBe(0); // Caught up!

        // Alice sends a 4th message
        await request(app).post('/send').send({
            idempotencyKey: `msg_4`,
            from: 'alice',
            to: 'bob',
            content: `Message 4`
        });

        // Bob syncs again
        const sync3 = await request(app).post('/sync/bob').send({});
        expect(sync3.body.messages.length).toBe(1);
        expect(sync3.body.messages[0].content).toBe('Message 4');
    });
});
