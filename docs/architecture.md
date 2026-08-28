# reliable-chat-messaging Architecture

## System Diagram
The following Mermaid.js sequence diagram maps the core workflow and interactions:

```mermaid
sequenceDiagram
    UserA->>WS: Send Msg
WS->>In-Memory LRU Cache / Node.js Maps: XADD (Stream)
In-Memory LRU Cache / Node.js Maps-)UserB: Notify via PubSub
UserB->>WS: Fetch Delta
```

## Component Breakdown
- **Core Technology**: Node.js, In-Memory LRU Cache / Node.js Maps
- **Design Paradigm**: Emphasizes high availability, fault tolerance, and security.

## Security & Scaling Considerations
- Strict boundary validations.
- Horizontal scalability achieved via stateless workers.
- Encrypted data at rest and in transit.
