---
title: "Multi-Tenancy Architecture: Database, Application, and Infrastructure Patterns"
description: "Production multi-tenancy: database isolation models (shared schema, shared database, separate database), tenant routing, data partitioning strategies, cross-tenant query prevention, Spring Boot tenant context propagation, and the trade-offs at each isolation level."
date: "2025-05-24"
category: "System Design"
tags: ["multi-tenancy", "saas", "system design", "database", "spring boot", "architecture", "isolation"]
featured: false
affiliateSection: "system-design-courses"
---

Multi-tenancy is the architecture pattern where a single deployed instance of a software system serves multiple customers (tenants), with each tenant's data logically or physically isolated from others. It's the foundation of SaaS products. The isolation model you choose is a fundamental architectural decision — it determines your security posture, operational complexity, cost structure, and scalability ceiling.

## The Three Isolation Models

```
Model 1: Shared Schema (Row-Level Isolation)
┌────────────────────────────────────────────┐
│  Single database, single schema            │
│  Every table has a tenant_id column        │
│  tenant A rows: tenant_id='A'              │
│  tenant B rows: tenant_id='B'              │
│  All tenants share tables                  │
└────────────────────────────────────────────┘
Cost: Lowest    Security: Lowest    Scale: Highest

Model 2: Shared Database, Separate Schemas
┌────────────────────────────────────────────┐
│  Single database server                    │
│  Schema per tenant: tenant_a.orders        │
│                     tenant_b.orders        │
│  No shared tables (except system tables)   │
└────────────────────────────────────────────┘
Cost: Medium    Security: Medium    Scale: Medium

Model 3: Separate Database (Database per Tenant)
┌──────────┐   ┌──────────┐   ┌──────────┐
│ Tenant A │   │ Tenant B │   │ Tenant C │
│    DB    │   │    DB    │   │    DB    │
└──────────┘   └──────────┘   └──────────┘
Cost: Highest   Security: Highest  Scale: Limited
```

Most SaaS products start with shared schema (simplest) and migrate toward separate databases as they land larger enterprise customers who demand data isolation guarantees.

## Model 1: Shared Schema with Row-Level Security

**PostgreSQL Row-Level Security (RLS):**

```sql
-- Enable RLS on every tenant-scoped table:
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Create policy: users can only see rows matching their tenant_id
CREATE POLICY tenant_isolation ON orders
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Set tenant context per connection/transaction:
SET app.current_tenant = '550e8400-e29b-41d4-a716-446655440000';

-- Now ALL queries on orders are automatically filtered:
SELECT * FROM orders;
-- Equivalent to: SELECT * FROM orders WHERE tenant_id = '550e8400-...'
-- Even if a query accidentally omits the tenant_id filter — RLS enforces it
```

RLS is a defense-in-depth layer. Even if application code has a bug that omits the tenant filter, RLS prevents cross-tenant data leakage at the database level.

**Spring Boot implementation:**

```java
// Tenant context holder (thread-local):
public class TenantContext {
    private static final ThreadLocal<String> currentTenant = new ThreadLocal<>();

    public static void setCurrentTenant(String tenantId) {
        currentTenant.set(tenantId);
    }

    public static String getCurrentTenant() {
        return currentTenant.get();
    }

    public static void clear() {
        currentTenant.remove();
    }
}

// Interceptor: extract tenant from request and set context
@Component
public class TenantInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request,
                              HttpServletResponse response,
                              Object handler) {
        // Option 1: Tenant from subdomain (acme.app.com → tenant=acme)
        String host = request.getServerName();
        String tenantId = host.split("\\.")[0];

        // Option 2: Tenant from JWT claim (more reliable)
        String jwt = extractJwt(request);
        String tenantId2 = jwtService.getTenantId(jwt);

        // Option 3: Tenant from request header (for internal APIs)
        String tenantId3 = request.getHeader("X-Tenant-ID");

        TenantContext.setCurrentTenant(tenantId2);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                 Object handler, Exception ex) {
        TenantContext.clear();  // CRITICAL: clean up thread-local or risk tenant leakage
    }
}

// Hibernate multi-tenancy — pass tenant_id to every query automatically:
@Component
public class TenantIdentifierResolver implements CurrentTenantIdentifierResolver {
    @Override
    public String resolveCurrentTenantIdentifier() {
        String tenantId = TenantContext.getCurrentTenant();
        return tenantId != null ? tenantId : "default";
    }

    @Override
    public boolean validateExistingCurrentSessions() {
        return true;
    }
}

// Entity: tenant_id on every table:
@Entity
@Table(name = "orders")
@FilterDef(name = "tenantFilter", parameters = @ParamDef(name = "tenantId", type = String.class))
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class Order {

    @Id
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    // ... other fields
}
```

**The critical risk in shared schema: accidental cross-tenant queries**

```java
// VULNERABLE: Developer forgets to add tenant filter
public List<Order> findRecentOrders() {
    return em.createQuery("FROM Order WHERE created_at > :date", Order.class)
        .setParameter("date", LocalDate.now().minusDays(7))
        .getResultList();
    // Returns orders from ALL tenants — data breach
}

// SAFE: Always include tenant_id
public List<Order> findRecentOrders() {
    String tenantId = TenantContext.getCurrentTenant();
    return em.createQuery(
        "FROM Order WHERE tenant_id = :tenantId AND created_at > :date", Order.class)
        .setParameter("tenantId", UUID.fromString(tenantId))
        .setParameter("date", LocalDate.now().minusDays(7))
        .getResultList();
}

// SAFER: Use Hibernate @Filter applied globally (can't forget it):
// Session.enableFilter("tenantFilter").setParameter("tenantId", tenantId)
// This adds the filter condition to ALL queries for the session
```

## Model 2: Schema-Per-Tenant

```java
// Hibernate connection pool routing:
@Configuration
public class MultiTenantDataSourceConfig implements MultiTenantConnectionProvider {

    @Autowired
    private DataSource dataSource;

    @Override
    public Connection getConnection(String tenantIdentifier) throws SQLException {
        Connection connection = dataSource.getConnection();
        // Switch schema to tenant's schema:
        connection.createStatement().execute(
            "SET search_path TO tenant_" + sanitize(tenantIdentifier) + ", public"
        );
        return connection;
    }

    @Override
    public void releaseConnection(String tenantIdentifier, Connection connection) throws SQLException {
        connection.createStatement().execute("SET search_path TO public");
        connection.close();
    }

    private String sanitize(String tenantId) {
        // CRITICAL: Sanitize to prevent SQL injection via tenant ID
        if (!tenantId.matches("^[a-zA-Z0-9_-]+$")) {
            throw new SecurityException("Invalid tenant ID");
        }
        return tenantId;
    }
}

// Schema provisioning (when a new tenant signs up):
@Service
public class TenantProvisioningService {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Transactional
    public void provisionTenant(String tenantId) {
        String schema = "tenant_" + sanitize(tenantId);

        // Create schema:
        jdbcTemplate.execute("CREATE SCHEMA IF NOT EXISTS " + schema);

        // Run migrations for this schema:
        Flyway.configure()
            .dataSource(dataSource)
            .schemas(schema)
            .locations("classpath:db/migration")
            .load()
            .migrate();

        log.info("Provisioned schema for tenant: {}", tenantId);
    }
}
```

Schema-per-tenant allows schema customization per tenant (enterprise customers often want custom fields). However, running migrations across thousands of schemas becomes a management challenge — a migration that takes 1 second per schema takes 17 minutes across 1,000 tenants.

## Model 3: Database-Per-Tenant with Dynamic Routing

```java
// Connection pool per tenant (HikariCP):
@Service
public class TenantDataSourceService {

    private final Map<String, DataSource> dataSources = new ConcurrentHashMap<>();
    private final TenantConfigRepository tenantConfigRepository;

    public DataSource getDataSource(String tenantId) {
        return dataSources.computeIfAbsent(tenantId, this::createDataSource);
    }

    private DataSource createDataSource(String tenantId) {
        TenantConfig config = tenantConfigRepository.findById(tenantId)
            .orElseThrow(() -> new TenantNotFoundException(tenantId));

        HikariConfig hikariConfig = new HikariConfig();
        hikariConfig.setJdbcUrl(config.getDatabaseUrl());
        hikariConfig.setUsername(config.getDbUser());
        hikariConfig.setPassword(config.getDbPassword());
        hikariConfig.setMaximumPoolSize(5);     // Small pool per tenant
        hikariConfig.setMinimumIdle(1);
        hikariConfig.setConnectionTimeout(5000);
        hikariConfig.setPoolName("tenant-" + tenantId);

        return new HikariDataSource(hikariConfig);
    }
}

// Spring AbstractRoutingDataSource:
@Component
public class TenantAwareDataSource extends AbstractRoutingDataSource {

    @Autowired
    private TenantDataSourceService tenantDataSourceService;

    @Override
    protected Object determineCurrentLookupKey() {
        return TenantContext.getCurrentTenant();
    }

    @Override
    protected DataSource determineTargetDataSource() {
        String tenantId = TenantContext.getCurrentTenant();
        return tenantDataSourceService.getDataSource(tenantId);
    }
}
```

**Database-per-tenant operational challenges:**
- 1,000 tenants = 1,000 database connection pools = potential for many idle connections
- Schema migrations must run against all tenant databases (usually via a migration runner that loops over all tenants)
- Monitoring 1,000 separate databases requires aggregated observability
- Cost scales linearly with tenant count (no sharing)

## Tenant Onboarding and Lifecycle

```java
@Service
public class TenantLifecycleService {

    // Asynchronous provisioning (tenant creation shouldn't block the signup response):
    @Async
    public CompletableFuture<Void> provisionNewTenant(TenantSignupRequest request) {
        String tenantId = UUID.randomUUID().toString();

        // 1. Create database record for tenant:
        Tenant tenant = tenantRepository.save(new Tenant(tenantId, request.getCompanyName()));

        // 2. Provision infrastructure (database/schema):
        tenantProvisioningService.provision(tenantId);

        // 3. Seed default data (roles, settings, sample data):
        tenantSeedingService.seedDefaults(tenantId);

        // 4. Send welcome email:
        emailService.sendWelcome(tenant, request.getAdminEmail());

        // 5. Update provisioning status:
        tenant.setStatus(TenantStatus.ACTIVE);
        tenantRepository.save(tenant);

        return CompletableFuture.completedFuture(null);
    }

    @Transactional
    public void suspendTenant(String tenantId) {
        Tenant tenant = tenantRepository.findById(tenantId)
            .orElseThrow(() -> new TenantNotFoundException(tenantId));
        tenant.setStatus(TenantStatus.SUSPENDED);
        tenantRepository.save(tenant);

        // Revoke active sessions:
        sessionService.revokeAllForTenant(tenantId);
    }
}
```

## Cross-Tenant Analytics (Admin Queries)

Admin queries (aggregate statistics across all tenants) require bypassing tenant isolation:

```java
// Dedicated admin data source — separate connection with elevated permissions:
@Configuration
public class AdminDataSourceConfig {

    @Bean("adminDataSource")
    public DataSource adminDataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(adminDbUrl);
        config.setUsername(adminDbUser);
        config.setPassword(adminDbPassword);
        return new HikariDataSource(config);
    }
}

@Repository
public class AdminAnalyticsRepository {

    @Autowired
    @Qualifier("adminDataSource")
    private DataSource adminDataSource;

    // Admin-only: revenue across all tenants
    public List<TenantRevenue> getRevenueByTenant(LocalDate startDate) {
        // In shared schema: query without tenant filter
        // In schema-per-tenant: UNION across all schemas
        // In db-per-tenant: federated query or aggregated via ETL pipeline
    }
}

// Protect with role-based access:
@PreAuthorize("hasRole('PLATFORM_ADMIN')")
@GetMapping("/admin/analytics/revenue")
public ResponseEntity<List<TenantRevenue>> getRevenue(@RequestParam LocalDate startDate) {
    return ResponseEntity.ok(adminAnalyticsRepository.getRevenueByTenant(startDate));
}
```

## Choosing the Right Model

| Factor | Shared Schema | Schema-per-Tenant | DB-per-Tenant |
|--------|--------------|-------------------|---------------|
| Setup complexity | Low | Medium | High |
| Per-tenant cost | Lowest | Low | High |
| Data isolation | Logical only | Stronger | Strongest |
| Enterprise compliance | Difficult | Possible | Easy |
| Schema customization | Hard | Possible | Easy |
| Migration complexity | Low | Medium | High (per-DB) |
| Max tenant scale | 100,000+ | 10,000 | ~1,000 |

Start with shared schema unless your target customers have strict data residency requirements on day one. Add schema-per-tenant for enterprise tiers where compliance demands it. Reserve database-per-tenant for your largest, highest-paying customers who need dedicated infrastructure guarantees.

The multi-tenancy model shapes every subsequent architectural decision — data backup, disaster recovery, schema evolution, performance isolation, and compliance reporting. Make this choice deliberately, with full awareness of where you want to be in 3-5 years, not just what's easiest to build today.
