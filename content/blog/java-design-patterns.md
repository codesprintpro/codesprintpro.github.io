---
title: "Java Design Patterns: When to Use Them, When to Avoid Them"
description: "Practical guide to Java design patterns with production examples. Covers Builder, Factory, Strategy, Observer, Decorator, and Command patterns with Spring Boot integration."
date: "2025-03-15"
category: "Java"
tags: ["java", "design patterns", "spring boot", "solid", "clean code"]
featured: false
affiliateSection: "java-courses"
---

Design patterns are solutions to recurring design problems. The mistake most engineers make is pattern-matching: "this code has a factory-like structure, let me add a Factory pattern." The right question is: "what problem am I solving?" Most of the time, a well-named class and a clean interface are better than a named pattern. This article shows when patterns genuinely improve code.

## Builder: Complex Object Construction

Use when constructing an object requires many parameters, especially optional ones. The classic symptom that Builder is the right choice is what is often called the "telescoping constructor" anti-pattern — a constructor call where you cannot tell what each argument means without looking up the signature. The following comparison makes this concrete:

```java
// Without Builder: telescoping constructors (anti-pattern)
new Order("cust-123", "NEW", BigDecimal.valueOf(99.99), "USD", null, null, true, false);
// Which field is which? What are those booleans?

// With Builder: readable, validated, immutable
@Builder
@Value  // Lombok: all fields final, getters, no setters
public class Order {
    String orderId;
    String customerId;
    OrderStatus status;
    BigDecimal totalAmount;
    String currency;
    String shippingAddressId;
    boolean expressShipping;
    boolean giftWrapped;
    Instant createdAt;

    // Custom validation in the builder
    public static class OrderBuilder {
        public Order build() {
            if (totalAmount == null || totalAmount.compareTo(BigDecimal.ZERO) <= 0) {
                throw new IllegalArgumentException("Total must be positive");
            }
            if (currency == null) currency = "USD";
            if (createdAt == null) createdAt = Instant.now();
            return new Order(orderId, customerId, status, totalAmount,
                           currency, shippingAddressId, expressShipping, giftWrapped, createdAt);
        }
    }
}

// Usage: self-documenting, compile-time checked
Order order = Order.builder()
    .orderId(UUID.randomUUID().toString())
    .customerId("cust-123")
    .status(OrderStatus.PENDING)
    .totalAmount(BigDecimal.valueOf(99.99))
    .expressShipping(true)
    .build();
```

Notice that the custom `build()` method centralizes validation and applies sensible defaults — logic that would otherwise be scattered across multiple constructors. By overriding the Lombok-generated `build()`, you get both the convenience of generated code and the safety of explicit invariant checks.

## Strategy: Swappable Algorithms

Use when you have multiple implementations of the same behavior and need to choose at runtime. The Strategy pattern is essentially a way to encode a decision that would otherwise live in a `switch` or `if-else` chain directly into the type system, making it easy to add new cases without touching existing code. Payment processing is a natural example — each payment provider has completely different API calls, but from the perspective of the service that processes payments, the interface is the same:

```java
// Payment processing: different strategies for different payment methods
public interface PaymentStrategy {
    PaymentResult process(PaymentRequest request);
    boolean supports(PaymentMethod method);
}

@Component
public class StripePaymentStrategy implements PaymentStrategy {

    @Override
    public PaymentResult process(PaymentRequest request) {
        // Stripe-specific implementation
        StripeCharge charge = stripeClient.charges().create(
            ChargeCreateParams.builder()
                .setAmount(request.getAmountCents())
                .setCurrency(request.getCurrency())
                .setSource(request.getToken())
                .build()
        );
        return PaymentResult.success(charge.getId());
    }

    @Override
    public boolean supports(PaymentMethod method) {
        return method == PaymentMethod.CREDIT_CARD || method == PaymentMethod.DEBIT_CARD;
    }
}

@Component
public class PayPalPaymentStrategy implements PaymentStrategy {

    @Override
    public PaymentResult process(PaymentRequest request) {
        // PayPal-specific implementation
        return payPalClient.execute(request);
    }

    @Override
    public boolean supports(PaymentMethod method) {
        return method == PaymentMethod.PAYPAL;
    }
}

// Context: selects and executes the right strategy
@Service
public class PaymentService {

    private final List<PaymentStrategy> strategies;  // Spring injects all implementations

    public PaymentService(List<PaymentStrategy> strategies) {
        this.strategies = strategies;
    }

    public PaymentResult processPayment(PaymentRequest request) {
        return strategies.stream()
            .filter(s -> s.supports(request.getPaymentMethod()))
            .findFirst()
            .orElseThrow(() -> new UnsupportedPaymentMethodException(request.getPaymentMethod()))
            .process(request);
    }
}
// Adding a new payment method = add a new @Component class. Zero changes to PaymentService.
```

The key insight here is how Spring's dependency injection and the Strategy pattern work together: by injecting `List<PaymentStrategy>`, Spring automatically collects every `@Component` that implements the interface. Adding a new payment method means writing a new class and annotating it — `PaymentService` never needs to know it exists.

## Factory / Factory Method: Controlled Object Creation

Use when the creation logic is complex, when clients shouldn't know the concrete type, or when object creation has side effects. The Factory pattern is appropriate when the act of creating an object requires knowledge that the caller should not need to have — like which dependencies to inject, what normalization to apply to inputs, or how to map a type enum to a concrete class:

```java
// Problem: NotificationService needs to create different notification types
// with different initialization requirements

public sealed interface Notification permits EmailNotification, SmsNotification, PushNotification {}

@Factory
public class NotificationFactory {

    @Autowired
    private EmailClient emailClient;

    @Autowired
    private SmsProvider smsProvider;

    @Autowired
    private PushNotificationService pushService;

    public Notification create(NotificationRequest request) {
        return switch (request.getType()) {
            case EMAIL -> new EmailNotification(
                emailClient,
                request.getRecipient(),
                request.getTemplate(),
                request.getVariables()
            );
            case SMS -> new SmsNotification(
                smsProvider,
                normalizePhoneNumber(request.getRecipient()),
                request.getMessage()
            );
            case PUSH -> new PushNotification(
                pushService,
                request.getDeviceToken(),
                request.getTitle(),
                request.getBody()
            );
        };
    }

    private String normalizePhoneNumber(String phone) {
        // E.164 format
        return phone.replaceAll("[^0-9+]", "");
    }
}
```

Using a `sealed interface` here is deliberate: it forces the `switch` expression to be exhaustive, so if you add a new `NotificationType` in the future the compiler will tell you that `NotificationFactory` needs to handle it — the type system enforces completeness.

## Observer (Event-Driven): Decoupled Reactions

Use when one event should trigger multiple independent reactions without coupling them. Think of it like a newspaper subscription: the publisher prints the paper without knowing who subscribes, and each subscriber reads it independently. Spring's `ApplicationEvent` mechanism is the idiomatic way to implement this in a Spring Boot application, and it integrates naturally with transactions through `@TransactionalEventListener`:

```java
// Spring's ApplicationEvent is the cleanest Observer implementation in Spring Boot

// The event
public record OrderCreatedEvent(Order order) implements ApplicationEvent {
    public OrderCreatedEvent(Order order) {
        this.order = order;
    }
}

// Publishers just fire events — they don't know about listeners
@Service
public class OrderService {

    @Autowired
    private ApplicationEventPublisher eventPublisher;

    public Order createOrder(OrderRequest request) {
        Order order = orderRepository.save(buildOrder(request));
        // Publish — OrderService has ZERO knowledge of what happens next
        eventPublisher.publishEvent(new OrderCreatedEvent(order));
        return order;
    }
}

// Listeners react independently
@Component
public class OrderEmailListener {

    @Async  // Don't block the request thread
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleOrderCreated(OrderCreatedEvent event) {
        emailService.sendOrderConfirmation(event.order());
    }
}

@Component
public class InventoryReservationListener {

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleOrderCreated(OrderCreatedEvent event) {
        inventoryService.reserve(event.order().getItems());
    }
}

@Component
public class AnalyticsListener {

    @Async
    @EventListener  // @EventListener fires even on transaction rollback
    public void handleOrderCreated(OrderCreatedEvent event) {
        analyticsService.track("order_created", event.order());
    }
}
// Adding a new reaction = add a new @Component. Zero changes to OrderService.
```

Notice the difference between `@TransactionalEventListener` (used by email and inventory) and `@EventListener` (used by analytics). Email and inventory reservation must only happen if the order transaction commits successfully — `AFTER_COMMIT` guarantees this. Analytics, by contrast, wants to track even failed orders, so it uses plain `@EventListener` which fires regardless of transaction outcome.

## Decorator: Composable Behavior

Use when you need to add behavior to an object dynamically without inheritance. Inheritance is a rigid relationship — once you make `CachingOrderRepository` extend `JpaOrderRepository`, you cannot swap the base implementation. The Decorator pattern solves this by wrapping the interface rather than extending the class, so each decorator only depends on the abstraction and can be composed in any order:

```java
// Repository with optional caching, audit logging, retry
public interface UserRepository {
    Optional<User> findById(String id);
    User save(User user);
}

@Repository
public class JpaUserRepository implements UserRepository {
    // Base implementation
    @Override
    public Optional<User> findById(String id) {
        return jpaRepo.findById(id);
    }
}

// Caching decorator
public class CachingUserRepository implements UserRepository {

    private final UserRepository delegate;
    private final Cache<String, User> cache;

    public CachingUserRepository(UserRepository delegate, Cache<String, User> cache) {
        this.delegate = delegate;
        this.cache = cache;
    }

    @Override
    public Optional<User> findById(String id) {
        User cached = cache.getIfPresent(id);
        if (cached != null) return Optional.of(cached);

        Optional<User> user = delegate.findById(id);
        user.ifPresent(u -> cache.put(id, u));
        return user;
    }

    @Override
    public User save(User user) {
        User saved = delegate.save(user);
        cache.put(saved.getId(), saved);  // Update cache on write
        return saved;
    }
}

// Audit logging decorator
public class AuditingUserRepository implements UserRepository {

    private final UserRepository delegate;
    private final AuditLog auditLog;

    @Override
    public User save(User user) {
        User saved = delegate.save(user);
        auditLog.record(AuditEntry.builder()
            .entityType("User").entityId(saved.getId())
            .action("SAVE").performedBy(SecurityContext.currentUser())
            .build());
        return saved;
    }
}

// Wire them together in Spring
@Configuration
public class RepositoryConfig {

    @Bean
    public UserRepository userRepository(JpaUserRepository base) {
        Cache<String, User> cache = Caffeine.newBuilder()
            .maximumSize(10_000).expireAfterWrite(5, TimeUnit.MINUTES).build();

        return new AuditingUserRepository(
            new CachingUserRepository(base, cache),
            auditLog
        );
    }
}
```

The `@Configuration` class at the end is where the power of this pattern becomes visible: you are composing three independent behaviors (JPA persistence, caching, and auditing) with no modification to any of the three classes. If you need to add retry logic tomorrow, you write a `RetryingUserRepository` decorator and add one more wrapper in `RepositoryConfig`.

## Command Pattern: Encapsulated Operations

Use for undo/redo, queuing operations, or transactional scripts. The Command pattern turns an operation into an object — which means you can store it, queue it, log it, and most importantly, reverse it. This is especially valuable in financial or administrative contexts where operations need to be reversible:

```java
// Command interface
public interface Command<T> {
    T execute();
    void undo();
}

// Commands are self-contained, reversible operations
public class TransferMoneyCommand implements Command<TransferResult> {

    private final Account fromAccount;
    private final Account toAccount;
    private final BigDecimal amount;
    private boolean executed = false;

    @Override
    public TransferResult execute() {
        if (fromAccount.getBalance().compareTo(amount) < 0) {
            throw new InsufficientFundsException(fromAccount.getId());
        }
        fromAccount.debit(amount);
        toAccount.credit(amount);
        executed = true;
        return TransferResult.success(fromAccount.getId(), toAccount.getId(), amount);
    }

    @Override
    public void undo() {
        if (!executed) return;
        toAccount.debit(amount);
        fromAccount.credit(amount);
        executed = false;
    }
}

// Command executor with undo history
@Service
public class CommandExecutor {

    private final Deque<Command<?>> history = new ArrayDeque<>();

    public <T> T execute(Command<T> command) {
        T result = command.execute();
        history.push(command);
        return result;
    }

    public void undoLast() {
        if (!history.isEmpty()) {
            history.pop().undo();
        }
    }
}
```

The `executed` flag in `TransferMoneyCommand` is a subtle but important guard: it prevents `undo()` from reversing a transfer that was never successfully applied, protecting against double-reversal bugs when error handling calls `undo()` on a command that threw during `execute()`.

## When NOT to Use Patterns

With several patterns now in your toolkit, the most important skill to develop is restraint. Every pattern adds indirection, which adds cognitive overhead for anyone reading the code. Apply a pattern only when the problem it solves is actually present, not when the code structure merely resembles a scenario where the pattern could apply:

```
Pattern overuse is more common than underuse:

Don't create a Factory when:
  new OrderService() is perfectly readable
  → Builder or constructor are clearer

Don't create a Strategy when:
  You only have one algorithm now (YAGNI)
  → Add it when the second strategy arrives

Don't create an Observer when:
  Only one listener will ever exist
  → Direct method call is simpler

Don't create a Decorator when:
  You own both the base class and the extension
  → Just modify the base class

The design principle behind patterns: SOLID
  S: Single Responsibility (Strategy, Command)
  O: Open/Closed (Strategy, Decorator, Observer)
  L: Liskov Substitution (all well-implemented patterns)
  I: Interface Segregation (narrow interfaces)
  D: Dependency Inversion (inject abstractions, not concretions)

Apply SOLID principles first. Patterns emerge naturally.
```

The most dangerous design pattern is the one you apply to feel like you're doing "proper engineering." Good code is readable code. A `UserRepository` with caching and auditing composed via Decorator is elegant. A `UserServiceFactoryImpl` with a `UserServiceFactoryImplFactory` is a joke. Patterns serve the code; the code doesn't serve the patterns.
