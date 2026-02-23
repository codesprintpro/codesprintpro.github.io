---
title: "gRPC vs REST vs GraphQL: Choosing the Right API Protocol"
description: "A technical comparison of REST, gRPC, and GraphQL across performance, developer experience, schema evolution, streaming, and real production use cases. When each protocol wins and where each falls short."
date: "2025-06-18"
category: "System Design"
tags: ["grpc", "rest", "graphql", "api design", "system design", "microservices", "protocol buffers"]
featured: false
affiliateSection: "system-design-courses"
---

API protocol selection has a longer lifespan than almost any other technical decision. REST APIs from 2010 are still running in production. gRPC services chosen for internal communication in 2018 are tightly coupled to their protobuf schemas. GraphQL queries written for a mobile app in 2019 are still constrained by the data graph that was designed then. Getting this choice right — or understanding the trade-offs well enough to migrate later — matters.

## REST: The Default for Good Reason

REST over HTTP/JSON is the dominant API paradigm. Its dominance comes not from technical superiority but from universal support: every HTTP client, every programming language, every debugging tool, every proxy, every API gateway supports it.

**Technical characteristics:**
- Text-based (JSON): human-readable, easy to debug with curl/Postman
- HTTP/1.1 or HTTP/2 transport
- Stateless request-response
- Standard HTTP semantics: GET (idempotent read), POST (create), PUT/PATCH (update), DELETE
- Cacheable at every layer (browser, CDN, reverse proxy)

**REST payload size vs gRPC:**
```
User object (4 fields):
JSON: {"id":12345,"name":"Alice Smith","email":"alice@example.com","role":"admin"}
      → 73 bytes

Protobuf (equivalent):
      → 32 bytes (~56% smaller)

At 100K requests/second:
JSON: 7.3 MB/s wire data
Protobuf: 3.2 MB/s wire data
```

The size difference compounds with complex nested objects. At 10K requests/second it's irrelevant. At 1M requests/second it affects infrastructure costs.

## gRPC: Performance and Strong Contracts

gRPC is RPC over HTTP/2 with Protocol Buffers as the serialization format.

**Define the service contract:**
```protobuf
// user_service.proto
syntax = "proto3";

package user.v1;

service UserService {
    rpc GetUser (GetUserRequest) returns (GetUserResponse);
    rpc CreateUser (CreateUserRequest) returns (CreateUserResponse);
    rpc WatchUserEvents (WatchEventsRequest) returns (stream UserEvent);
    // ^ Server streaming: server sends multiple responses for one request
    rpc BulkImportUsers (stream ImportUserRequest) returns (ImportResult);
    // ^ Client streaming: client sends stream, server sends single response
}

message GetUserRequest {
    int64 user_id = 1;
}

message GetUserResponse {
    int64 user_id = 1;
    string name = 2;
    string email = 3;
    UserRole role = 4;
    google.protobuf.Timestamp created_at = 5;
}

enum UserRole {
    USER_ROLE_UNSPECIFIED = 0;
    USER_ROLE_ADMIN = 1;
    USER_ROLE_VIEWER = 2;
}
```

Generate code: `protoc --java_out=. --grpc-java_out=. user_service.proto`

**Java Spring Boot gRPC server:**
```java
@GrpcService
public class UserServiceImpl extends UserServiceGrpc.UserServiceImplBase {

    @Override
    public void getUser(GetUserRequest request, StreamObserver<GetUserResponse> observer) {
        try {
            User user = userRepository.findById(request.getUserId())
                .orElseThrow(() -> Status.NOT_FOUND
                    .withDescription("User not found: " + request.getUserId())
                    .asRuntimeException());

            observer.onNext(GetUserResponse.newBuilder()
                .setUserId(user.getId())
                .setName(user.getName())
                .setEmail(user.getEmail())
                .setRole(UserRole.forNumber(user.getRoleOrdinal()))
                .setCreatedAt(Timestamps.fromMillis(user.getCreatedAt().toEpochMilli()))
                .build());
            observer.onCompleted();
        } catch (StatusRuntimeException e) {
            observer.onError(e);
        }
    }

    // Server streaming:
    @Override
    public void watchUserEvents(WatchEventsRequest request,
                                 StreamObserver<UserEvent> observer) {
        eventBus.subscribe(request.getUserId(), event -> {
            if (observer.isReady()) {
                observer.onNext(UserEvent.from(event));
            }
        });
        // Stream stays open until client disconnects
    }
}
```

**gRPC advantages:**
- HTTP/2 multiplexing: multiple RPC calls over one TCP connection
- Bidirectional streaming: real-time updates without WebSockets
- Strong typing: protobuf schema enforced at compile time
- Code generation: client stubs auto-generated for 12+ languages
- Deadlines/timeouts: first-class in the protocol

**gRPC disadvantages:**
- Not browser-native: requires gRPC-Web proxy (Envoy) for browser clients
- Binary format: cannot debug with curl; need grpcurl or Postman with gRPC support
- Schema changes: require careful backward compatibility (`reserved` field numbers, avoid renaming)
- Operational complexity: TLS required in many environments

## GraphQL: Flexible Queries for Complex Data Graphs

GraphQL lets clients specify exactly the data they need — no over-fetching, no under-fetching.

```graphql
# Schema definition:
type User {
    id: ID!
    name: String!
    email: String!
    orders(first: Int, after: String): OrderConnection
    recommendedProducts(limit: Int): [Product]
}

type Order {
    id: ID!
    total: Float!
    status: OrderStatus!
    items: [OrderItem!]!
    createdAt: DateTime!
}

# Client query — ask for exactly what's needed:
query GetUserDashboard($userId: ID!) {
    user(id: $userId) {
        name
        email
        orders(first: 5) {
            edges {
                node {
                    id
                    total
                    status
                    createdAt
                }
            }
        }
    }
}
```

**The N+1 problem in GraphQL:**

Without a DataLoader, a query for 10 users with their orders runs 1 + 10 = 11 queries:
```
SELECT * FROM users LIMIT 10;
SELECT * FROM orders WHERE user_id = 1;
SELECT * FROM orders WHERE user_id = 2;
...
```

DataLoader batches these into 2 queries:
```java
@Component
public class OrderDataLoader implements BatchLoader<Long, List<Order>> {
    @Override
    public CompletionStage<List<List<Order>>> load(List<Long> userIds) {
        return CompletableFuture.supplyAsync(() ->
            orderRepository.findByUserIdIn(userIds)
                .stream()
                .collect(groupingBy(Order::getUserId))
                .entrySet()
                .stream()
                .map(entry -> entry.getValue())
                .collect(toList())
        );
    }
}
```

**GraphQL disadvantages:**
- Complex queries (deep nesting, broad fan-out) can be computationally expensive — add query depth limiting and cost analysis
- HTTP caching: all queries go to POST /graphql — CDN caching is harder
- Over-flexible: clients can request any combination → hard to predict/optimize backend performance
- Error handling: HTTP always returns 200, errors are in the response body — breaks standard monitoring

## Performance Comparison

```
Latency benchmark (local, 8-core, simple object fetch):
REST JSON (HTTP/1.1):    8ms P50,  15ms P99
REST JSON (HTTP/2):      5ms P50,  10ms P99
gRPC (HTTP/2 + protobuf): 2ms P50,   5ms P99
GraphQL (simple query):   6ms P50,  14ms P99

Throughput (requests/second, single connection):
REST JSON:     5,000 RPS
gRPC:         15,000 RPS   (~3× due to HTTP/2 + binary serialization)
GraphQL:       4,000 RPS   (schema validation overhead)
```

gRPC's throughput advantage comes from HTTP/2 multiplexing (no head-of-line blocking) and binary protobuf serialization. For internal service-to-service calls at high volume, this matters.

## Schema Evolution and Backward Compatibility

**REST:** No formal mechanism. In practice: URL versioning (`/v1/`, `/v2/`), add-only field changes, deprecation headers. Works but requires documentation discipline.

**gRPC/protobuf schema evolution:**
```protobuf
// Original message:
message CreateUserRequest {
    string name = 1;
    string email = 2;
}

// SAFE additions:
message CreateUserRequest {
    string name = 1;
    string email = 2;
    string phone = 3;      // New optional field — old clients ignore it
    UserPreferences prefs = 4;
}

// DANGEROUS (breaks clients):
message CreateUserRequest {
    string full_name = 1;  // Renamed field 1 → binary format compatible, but confusing
    string email = 2;
    // name field removed → old clients sending field 1 still work (it's just ignored)
    reserved 3;            // Reserve old field number if you remove field phone
    reserved "phone";      // Reserve old field name
}
```

**GraphQL deprecation:**
```graphql
type User {
    name: String
    fullName: String @deprecated(reason: "Use `name` instead")
}
```

gRPC's protobuf rules are the most explicit: field numbers are permanent, removal requires `reserved`. REST's flexibility is also its fragility — without discipline, breaking changes slip through.

## When to Use Each

**Use REST when:**
- External-facing API (third-party developers, mobile apps, browsers)
- Team lacks protobuf expertise
- Standard HTTP caching is important (CDN, browser cache)
- Simple CRUD operations with no streaming requirements

**Use gRPC when:**
- Internal service-to-service communication at high throughput
- Polyglot environment (Go services talking to Java services)
- Streaming is required (real-time event subscriptions)
- Strong typing and auto-generated clients reduce contract drift risk

**Use GraphQL when:**
- Frontend teams need flexibility to compose data without backend changes
- Complex data graph with many entity relationships (social graph, product catalog with variants/options)
- Multiple clients with different data requirements (mobile needs less data than web)
- BFF (Backend for Frontend) layer serving a specific client type

**Common pattern in production:**
```
External clients (browser, mobile)
    → REST/GraphQL API Gateway

Internal services
    → gRPC for synchronous service calls
    → Kafka/SQS for async event-driven communication
```

The API surface visible to external developers should be stable and REST/GraphQL. Internal service communication can afford gRPC's operational requirements in exchange for performance and type safety.
