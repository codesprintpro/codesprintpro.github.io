---
title: "API Design: REST vs GraphQL vs gRPC — When to Use Each"
description: "Deep comparison of REST, GraphQL, and gRPC for API design. Learn the trade-offs, use cases, and implementation patterns to choose the right protocol for your system."
date: "2025-03-01"
category: "System Design"
tags: ["api", "rest", "graphql", "grpc", "system design", "microservices"]
featured: false
affiliateSection: "system-design-courses"
---

Every microservices architecture makes an implicit bet on an API protocol. REST is familiar but verbose. GraphQL is flexible but complex. gRPC is fast but opinionated. Choosing wrong costs you months of refactoring. This article gives you the mental model to choose right the first time.

## The Core Trade-off

Before diving into code, it helps to internalize the fundamental personality of each protocol. Think of them as different tools in a workshop — a hammer, a screwdriver, and a wrench each solve problems the others can't. The table below is the mental shortcut you'll return to whenever you're evaluating a new API surface.

```
REST:     Standard, cacheable, human-readable. Overfetching is the enemy.
GraphQL:  Client-defined queries. Solves overfetching. Adds query complexity.
gRPC:     Binary protocol, bidirectional streaming, 10x faster than REST.
          Requires Protobuf contracts. Not browser-native.
```

## REST: The Default Choice

REST (Representational State Transfer) models your API around **resources** and **HTTP verbs**.

REST maps your domain objects to URLs and uses standard HTTP methods to express what you want to do with them. This uniformity is REST's superpower — any developer who has used an HTTP API before can guess how your API works without reading the docs. The example below shows the URL structure and verb mapping you should follow for a standard resource.

```
Resource: /orders/{id}
GET    /orders/123         → Retrieve order 123
POST   /orders             → Create new order
PUT    /orders/123         → Replace order 123
PATCH  /orders/123         → Partial update order 123
DELETE /orders/123         → Delete order 123

Nested resources:
GET    /orders/123/items   → Items of order 123
POST   /orders/123/items   → Add item to order 123
```

### REST API Design — Getting It Right

Good REST goes beyond just using the right HTTP verb — it uses HTTP's semantics correctly, including response codes and headers. The controller below demonstrates several REST best practices: sparse fieldsets to reduce overfetching, the `201 Created` status with a `Location` header on creation, and a dedicated PATCH endpoint for partial updates.

```java
@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {

    @GetMapping("/{id}")
    public ResponseEntity<OrderResponse> getOrder(
            @PathVariable String id,
            @RequestParam(required = false) Set<String> fields) {  // Sparse fieldsets
        Order order = orderService.findById(id)
            .orElseThrow(() -> new OrderNotFoundException(id));
        return ResponseEntity.ok(OrderResponse.from(order, fields));
    }

    @PostMapping
    public ResponseEntity<OrderResponse> createOrder(
            @Valid @RequestBody CreateOrderRequest request,
            UriComponentsBuilder uriBuilder) {
        Order order = orderService.create(request);
        URI location = uriBuilder.path("/api/v1/orders/{id}")
            .buildAndExpand(order.getId()).toUri();
        // Return 201 Created with Location header — this is correct REST
        return ResponseEntity.created(location).body(OrderResponse.from(order));
    }

    @PatchMapping("/{id}/status")
    public ResponseEntity<OrderResponse> updateStatus(
            @PathVariable String id,
            @Valid @RequestBody UpdateStatusRequest request) {
        Order order = orderService.updateStatus(id, request.getStatus());
        return ResponseEntity.ok(OrderResponse.from(order));
    }
}
```

The `Location` header in the `201 Created` response is something many APIs skip, but it's essential for good REST design — it tells the client exactly where the newly created resource lives without requiring a separate lookup.

### REST Error Response Standard

Error handling is where many REST APIs diverge and create friction for API consumers. RFC 7807 (Problem Details) defines a standard error envelope that any HTTP client can parse consistently. Using this format means your error responses are as predictable as your success responses.

```java
// Problem Details (RFC 7807) — the standardized error format
@ExceptionHandler(OrderNotFoundException.class)
public ResponseEntity<ProblemDetail> handleNotFound(OrderNotFoundException ex) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(
        HttpStatus.NOT_FOUND,
        "Order " + ex.getId() + " not found"
    );
    problem.setTitle("Order Not Found");
    problem.setInstance(URI.create("/api/v1/orders/" + ex.getId()));
    problem.setProperty("orderId", ex.getId());
    return ResponseEntity.status(404).body(problem);
}

// Response:
// {
//   "type": "about:blank",
//   "title": "Order Not Found",
//   "status": 404,
//   "detail": "Order abc-123 not found",
//   "instance": "/api/v1/orders/abc-123",
//   "orderId": "abc-123"
// }
```

### REST Pagination

Pagination is a problem every list endpoint must solve, and the choice of strategy affects scalability significantly. Offset-based pagination (`?page=2&size=20`) is intuitive but breaks when records are inserted between pages. Cursor-based pagination is stable regardless of concurrent writes and is what you should use for any dataset that changes frequently.

```java
// Cursor-based pagination (preferred for large/changing datasets)
@GetMapping
public ResponseEntity<PagedResponse<OrderSummary>> listOrders(
        @RequestParam(required = false) String cursor,     // Opaque cursor (base64 encoded)
        @RequestParam(defaultValue = "20") int limit) {

    OrderPage page = orderService.findPage(cursor, Math.min(limit, 100));

    return ResponseEntity.ok(PagedResponse.<OrderSummary>builder()
        .data(page.getItems())
        .nextCursor(page.getNextCursor())          // null if last page
        .hasMore(page.hasMore())
        .totalCount(page.getTotalCount())
        .build());
}

// Client follows: GET /orders?cursor=eyJpZCI6IjEyMyJ9&limit=20
```

The cursor is opaque to the client (base64-encoded), which means you can change the internal pagination implementation — switching from ID-based to timestamp-based, for example — without breaking any clients.

**REST sweet spot:** Public APIs, CRUD services, when HTTP caching matters, mobile clients where you control bandwidth.

**REST problems:** Overfetching (getting 30 fields when you need 3), underfetching (N+1 — getting orders then making N calls for each order's customer).

---

## GraphQL: Client-Defined Queries

GraphQL lets clients request exactly the data they need — no more, no less. One endpoint (`/graphql`) handles everything.

The core idea behind GraphQL is inverting the control of data shaping: instead of the server deciding what fields to return, the client declares exactly what it needs. This is especially powerful when you have multiple clients — a mobile app, a web dashboard, and a partner integration — all with different data requirements hitting the same backend. The schema below defines what the server can provide; the query below it shows how a client selects a precise subset.

```graphql
# Schema (server defines capabilities)
type Query {
  order(id: ID!): Order
  orders(filter: OrderFilter, limit: Int, cursor: String): OrderConnection!
  me: User!
}

type Order {
  id: ID!
  status: OrderStatus!
  total: Float!
  customer: Customer!         # Nested object — no extra round trip
  items: [OrderItem!]!
  createdAt: DateTime!
}

type Customer {
  id: ID!
  name: String!
  email: String!
}

# Client query — requests exactly what it needs
query GetOrderWithCustomer($orderId: ID!) {
  order(id: $orderId) {
    id
    status
    total
    customer {
      name        # Only name — not email, address, etc.
    }
    items {
      productName
      quantity
      price
    }
  }
}
```

Notice that the client requests `customer.name` but not `customer.email` — the server only fetches and returns what was requested. This is in direct contrast to REST, where you'd get the entire customer object whether you needed it or not.

### Spring Boot GraphQL Implementation

The Spring GraphQL implementation maps GraphQL query fields to Java methods through annotations. The critical piece here is the `DataLoader` for the `customer` field — without it, loading 10 orders would trigger 10 separate customer queries (the GraphQL equivalent of the N+1 problem you saw in the REST section).

```java
// build.gradle
// implementation 'org.springframework.boot:spring-boot-starter-graphql'

@Controller
public class OrderGraphQLController {

    @QueryMapping
    public Order order(@Argument String id) {
        return orderService.findById(id)
            .orElseThrow(() -> new GraphQLException("Order not found: " + id));
    }

    @QueryMapping
    public Connection<Order> orders(@Argument OrderFilter filter,
                                    @Argument int limit,
                                    @Argument String cursor) {
        return orderService.findPage(filter, limit, cursor);
    }

    // DataLoader: batch-load customers to avoid N+1
    @SchemaMapping(typeName = "Order", field = "customer")
    public CompletableFuture<Customer> customer(Order order,
                                                 DataLoader<String, Customer> customerLoader) {
        return customerLoader.load(order.getCustomerId());
        // All customer loads within one request are batched into a single DB query
    }
}

// DataLoader registration (batches N customer loads into 1 DB query)
@Bean
public BatchLoaderRegistry batchLoaderRegistry() {
    BatchLoaderRegistry registry = new DefaultBatchLoaderRegistry();
    registry.forTypePair(String.class, Customer.class)
        .withName("customerLoader")
        .registerBatchLoader((ids, env) ->
            Mono.fromCallable(() -> customerService.findAllByIds(ids))
        );
    return registry;
}
```

The `BatchLoaderRegistry` is where the magic happens: instead of loading each customer immediately, it collects all customer IDs from a single request and fires one batched database query. This is a non-negotiable pattern — GraphQL without DataLoaders at scale is a performance disaster.

### GraphQL Mutations

While queries read data, mutations modify it. GraphQL mutations differ from REST POST/PUT in one important way: they return a payload type that can contain both the result and business-level errors as data, rather than relying on HTTP status codes to signal what went wrong.

```graphql
type Mutation {
  createOrder(input: CreateOrderInput!): CreateOrderPayload!
  updateOrderStatus(id: ID!, status: OrderStatus!): Order!
}

input CreateOrderInput {
  customerId: ID!
  items: [OrderItemInput!]!
  shippingAddress: AddressInput!
}

type CreateOrderPayload {
  order: Order            # The created order
  errors: [UserError!]    # Business errors (not HTTP 4xx)
}

type UserError {
  field: String
  message: String!
}
```

```java
@MutationMapping
public CreateOrderPayload createOrder(@Argument CreateOrderInput input) {
    try {
        Order order = orderService.create(input);
        return CreateOrderPayload.success(order);
    } catch (ValidationException e) {
        return CreateOrderPayload.error(e.getField(), e.getMessage());
    }
}
```

Returning business errors in the payload (rather than throwing HTTP 422 errors) is a deliberate GraphQL convention — it means the GraphQL response always has HTTP 200, and clients handle business logic errors through the `errors` field in the response body. This keeps your error handling consistent regardless of the operation.

**GraphQL sweet spot:** Mobile apps (bandwidth-sensitive), complex dashboards with many different data shapes, BFF (Backend For Frontend) pattern, when you have multiple clients needing different views of the same data.

**GraphQL problems:** Query complexity attacks (clients can request deeply nested data), N+1 problem (requires DataLoader), caching is harder (no HTTP GET caching), learning curve.

---

## gRPC: High-Performance Service Communication

gRPC uses HTTP/2 and Protocol Buffers (binary serialization). It's 5-10x faster than REST/JSON for inter-service communication.

Where REST uses human-readable JSON over HTTP/1.1, gRPC uses compact binary encoding over HTTP/2. Think of the difference between sending a hand-written letter and sending a compressed file — both carry information, but one is far more efficient to transmit and parse. The Protobuf schema below is the contract that both sides of a gRPC call agree on; it generates type-safe client and server code in any supported language.

```protobuf
// order_service.proto
syntax = "proto3";

package order.v1;

service OrderService {
  rpc GetOrder (GetOrderRequest) returns (Order);
  rpc CreateOrder (CreateOrderRequest) returns (Order);
  rpc UpdateOrderStatus (UpdateStatusRequest) returns (Order);

  // Server streaming: stream order updates to client
  rpc WatchOrder (WatchOrderRequest) returns (stream OrderEvent);

  // Client streaming: bulk upload orders
  rpc BulkCreateOrders (stream CreateOrderRequest) returns (BulkCreateResponse);

  // Bidirectional streaming: real-time order management
  rpc ManageOrders (stream OrderCommand) returns (stream OrderEvent);
}

message Order {
  string id = 1;
  string customer_id = 2;
  OrderStatus status = 3;
  repeated OrderItem items = 4;
  int64 total_cents = 5;           // Avoid floats for money
  google.protobuf.Timestamp created_at = 6;
}

enum OrderStatus {
  ORDER_STATUS_UNSPECIFIED = 0;   // Proto3: always define 0 case
  ORDER_STATUS_PENDING = 1;
  ORDER_STATUS_CONFIRMED = 2;
  ORDER_STATUS_SHIPPED = 3;
  ORDER_STATUS_DELIVERED = 4;
  ORDER_STATUS_CANCELLED = 5;
}

message GetOrderRequest {
  string id = 1;
}
```

Notice that `total_cents` stores money as an integer instead of a float — this is a deliberate choice to avoid floating-point precision errors when dealing with currency. The streaming RPCs (`WatchOrder`, `BulkCreateOrders`, `ManageOrders`) are capabilities that REST simply cannot match cleanly. The Java server implementation maps directly to these proto definitions.

```java
// Server implementation
@GrpcService
public class OrderGrpcService extends OrderServiceGrpc.OrderServiceImplBase {

    @Override
    public void getOrder(GetOrderRequest request, StreamObserver<Order> responseObserver) {
        try {
            com.example.Order order = orderService.findById(request.getId())
                .orElseThrow(() -> Status.NOT_FOUND
                    .withDescription("Order not found: " + request.getId())
                    .asRuntimeException());

            responseObserver.onNext(toProto(order));
            responseObserver.onCompleted();
        } catch (StatusRuntimeException e) {
            responseObserver.onError(e);
        }
    }

    @Override
    public void watchOrder(WatchOrderRequest request,
                           StreamObserver<OrderEvent> responseObserver) {
        // Server streaming: push updates as order progresses
        String orderId = request.getOrderId();
        orderEventService.subscribe(orderId, event -> {
            if (!responseObserver.isReady()) return;
            responseObserver.onNext(toProto(event));
            if (event.isFinal()) responseObserver.onCompleted();
        });
    }
}

// Client (another service calling OrderService)
@Service
public class PaymentService {

    private final OrderServiceGrpc.OrderServiceBlockingStub orderStub;

    public void processPayment(String orderId) {
        // Unary call with deadline
        Order order = orderStub
            .withDeadlineAfter(500, TimeUnit.MILLISECONDS)
            .getOrder(GetOrderRequest.newBuilder().setId(orderId).build());

        // order is type-safe — proto-generated class
    }
}
```

The `.withDeadlineAfter(500, TimeUnit.MILLISECONDS)` call on the client stub is critical for production resilience — without deadlines, a slow upstream service can hold your threads indefinitely and cascade into a timeout storm across your entire service mesh. Always set deadlines on outbound gRPC calls.

### gRPC Performance Numbers

The performance gap between gRPC and REST isn't theoretical — here are concrete numbers from a representative benchmark. The two main drivers are binary serialization (Protobuf vs JSON) and HTTP/2 multiplexing, which eliminates head-of-line blocking and reduces connection overhead.

```
Benchmark: 10,000 requests/sec, 1KB payload, same machine

REST/JSON (Spring MVC):
  p50 latency: 8ms
  p99 latency: 45ms
  CPU: 65%

gRPC/Protobuf (same logic):
  p50 latency: 1.2ms     ← 6.7x faster
  p99 latency: 7ms       ← 6.4x faster
  CPU: 28%               ← 2.3x less CPU

Why: Binary serialization + HTTP/2 multiplexing + header compression
```

The CPU reduction is especially important in microservice architectures — every percentage point of CPU saved at 10,000 RPS translates directly to infrastructure cost. For internal service calls that happen millions of times per day, this difference is significant.

**gRPC sweet spot:** Internal microservice-to-microservice communication, streaming use cases, polyglot environments (Go, Java, Python talking to each other), when you need maximum throughput and minimum latency.

**gRPC problems:** No browser support natively (needs gRPC-Web proxy), harder to debug (binary protocol), requires Protobuf toolchain, contract management.

---

## The Decision Framework

With all three protocols understood in depth, you need a practical way to make the call for a new API surface. The two questions below cut through most of the deliberation: who is calling your API, and what shape does your data have?

```
┌─────────────────────────────────────────────────────────────────┐
│                    Who are your clients?                         │
│                                                                   │
│  External/Public API ──────────────────────────► REST           │
│  (browsers, third-party, mobile)                                  │
│                                                                   │
│  Internal service-to-service ──────────────────► gRPC           │
│  (no browser, max performance)                                    │
│                                                                   │
│  Multiple clients, different data needs ───────► GraphQL        │
│  (mobile + web, BFF pattern)                                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    What's your data shape?                        │
│                                                                   │
│  Simple CRUD, well-defined resources ──────────► REST           │
│  Deeply nested, relationship-heavy data ───────► GraphQL        │
│  Streaming, real-time, bidirectional ──────────► gRPC           │
└─────────────────────────────────────────────────────────────────┘
```

| Factor | REST | GraphQL | gRPC |
|---|---|---|---|
| **Browser support** | Native | Native | Needs proxy |
| **Caching** | Excellent (HTTP cache) | Hard | Manual |
| **Overfetching** | Common problem | Solved | N/A |
| **Streaming** | Limited (SSE) | Subscriptions | Native |
| **Performance** | Good | Good | Excellent |
| **Learning curve** | Low | Medium | Medium |
| **Tooling/ecosystem** | Excellent | Good | Good |
| **Contract-first** | Optional (OpenAPI) | Schema required | Protobuf required |
| **Best for** | Public APIs | Complex clients | Internal services |

## Real-World Architecture: Use All Three

In practice, mature production systems don't pick one protocol and force it everywhere — they use each protocol where it excels. The architecture below is representative of how companies like Uber and Netflix structure their API layers. REST faces the public; gRPC connects internal services for speed; GraphQL serves as a flexible aggregation layer for complex client needs.

```
External clients (browser, mobile)
    │
    ▼
API Gateway (REST)      ← Public-facing, cacheable, familiar
    │
    ├──► User Service ──────── gRPC ──► Auth Service
    │                                       │
    ├──► Product Service ──── gRPC ──► Inventory Service
    │                                       │
    ├──► BFF Service ────── GraphQL ──► (aggregates Product + User)
    │         │                          (serves mobile app)
    └──► Order Service ───── gRPC ──► Payment Service
                                         │
                                     Notification Service
                                     (gRPC streaming)
```

The gateway is REST. Internal hop is gRPC. The mobile BFF is GraphQL. This isn't over-engineering — each protocol does one thing well.

The worst outcome is picking one protocol for ideological reasons and forcing it everywhere. REST for streaming is painful. gRPC for public APIs is hostile to users. GraphQL for simple CRUD is overengineered. Let the use case choose the protocol.
