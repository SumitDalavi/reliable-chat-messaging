const fc = require('fast-check');

class MessageBuffer {
    constructor() {
        this.buffer = [];
        this.nextSeq = 1;
    }
    receive(msg, emit) {
        this.buffer.push(msg);
        this.buffer.sort((a, b) => a.seq - b.seq);
        while (this.buffer.length > 0 && this.buffer[0].seq === this.nextSeq) {
            emit(this.buffer.shift());
            this.nextSeq++;
        }
    }
    flush(emit) {
        while (this.buffer.length > 0) {
            emit(this.buffer.shift());
        }
    }
}

describe('MessageBuffer Property Tests', () => {
    it('should always yield messages in strictly ascending sequence number order, regardless of arrival order', () => {
        fc.assert(
            fc.property(
                // Generate an array of message objects with unique sequence numbers
                fc.set(fc.record({
                    seq: fc.integer({ min: 1, max: 1000 }),
                    content: fc.string()
                }), { compare: (a, b) => a.seq === b.seq }),
                (messages) => {
                    const buffer = new MessageBuffer(); // Simple buffer logic
                    const emitted = [];
                    
                    // Simulate out-of-order network arrival by shuffling
                    const shuffled = [...messages].sort(() => Math.random() - 0.5);
                    
                    // Push all messages into the buffer
                    for (const msg of shuffled) {
                        buffer.receive(msg, (orderedMsg) => {
                            emitted.push(orderedMsg);
                        });
                    }

                    // Flush any remaining sequential messages just in case
                    buffer.flush((orderedMsg) => {
                        emitted.push(orderedMsg);
                    });

                    // Check property: the emitted messages MUST be strictly ascending
                    for (let i = 1; i < emitted.length; i++) {
                        if (emitted[i].seq <= emitted[i - 1].seq) {
                            return false; // Property violated
                        }
                    }
                    return true;
                }
            )
        );
    });
});
