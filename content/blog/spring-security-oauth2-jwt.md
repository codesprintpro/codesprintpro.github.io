---
title: "Spring Security OAuth2 and JWT: Production Implementation Guide"
description: "Complete Spring Security OAuth2 implementation: JWT token validation, Resource Server configuration, method-level security, custom UserDetailsService, refresh token rotation, and the security pitfalls that lead to authentication bypasses."
date: "2025-06-03"
category: "Java"
tags: ["spring security", "oauth2", "jwt", "spring boot", "authentication", "authorization", "java", "security"]
featured: false
affiliateSection: "java-courses"
---

Spring Security is one of the most powerful and most misunderstood frameworks in the Java ecosystem. Its flexibility is its strength — and its complexity. Misconfigured security is worse than no security, because it gives false assurance. This article covers production-grade Spring Security OAuth2 implementation: token validation, authorization rules, and the attack vectors you must close.

## The OAuth2 / JWT Architecture

Modern web applications use OAuth2 Bearer tokens — typically JWTs — for stateless authentication:

```
Client → POST /api/orders
         Authorization: Bearer eyJhbGci...

Spring Security filter chain:
1. JwtAuthenticationFilter extracts token from Authorization header
2. JwtDecoder validates signature, expiry, issuer, audience
3. JwtAuthenticationConverter extracts roles from claims
4. SecurityContextHolder stores Authentication
5. @PreAuthorize or SecurityConfig.authorizeHttpRequests() checks roles
6. Controller method executes with authenticated principal
```

The token is issued by an Authorization Server (Auth0, Keycloak, AWS Cognito, or your own Spring Authorization Server). The API (Resource Server) validates tokens without calling the Auth Server on each request — it uses the Auth Server's public key to verify the JWT signature locally.

## Resource Server Configuration

```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity  // Enables @PreAuthorize, @PostAuthorize, @Secured
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // Disable CSRF for stateless REST APIs (JWT carries CSRF protection implicitly):
            .csrf(csrf -> csrf.disable())
            // Stateless sessions — no HttpSession created:
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            // Authorization rules:
            .authorizeHttpRequests(auth -> auth
                // Public endpoints:
                .requestMatchers("/actuator/health", "/actuator/info").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/auth/**").permitAll()
                // All other endpoints require authentication:
                .anyRequest().authenticated()
            )
            // Configure as OAuth2 Resource Server with JWT:
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .jwtAuthenticationConverter(jwtAuthenticationConverter())
                )
                // Custom 401 response (default is an empty 401):
                .authenticationEntryPoint((request, response, ex) -> {
                    response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                    response.getWriter().write(
                        "{\"error\":\"unauthorized\",\"message\":\"" + ex.getMessage() + "\"}"
                    );
                })
            );

        return http.build();
    }

    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter grantedAuthoritiesConverter =
            new JwtGrantedAuthoritiesConverter();
        // Read roles from 'roles' claim (not 'scope' — which is the default):
        grantedAuthoritiesConverter.setAuthoritiesClaimName("roles");
        // Prefix roles with ROLE_ for Spring Security's hasRole() to work:
        grantedAuthoritiesConverter.setAuthorityPrefix("ROLE_");

        JwtAuthenticationConverter jwtConverter = new JwtAuthenticationConverter();
        jwtConverter.setJwtGrantedAuthoritiesConverter(grantedAuthoritiesConverter);
        return jwtConverter;
    }
}
```

**JWT decoder configuration — critical security property:**

```java
@Bean
public JwtDecoder jwtDecoder() {
    // Option 1: JWKS (recommended for production — Auth Server rotates keys)
    // Spring fetches public keys from the Auth Server's JWKS endpoint:
    NimbusJwtDecoder decoder = NimbusJwtDecoder
        .withJwkSetUri("https://auth.example.com/.well-known/jwks.json")
        .build();

    // Add custom validation (in addition to signature and expiry):
    OAuth2TokenValidator<Jwt> audienceValidator = token -> {
        if (token.getAudience().contains("order-service")) {
            return OAuth2TokenValidatorResult.success();
        }
        return OAuth2TokenValidatorResult.failure(
            new OAuth2Error("invalid_token", "Wrong audience", null));
    };

    OAuth2TokenValidator<Jwt> withIssuer = JwtValidators.createDefaultWithIssuer(
        "https://auth.example.com"
    );

    decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
        withIssuer,
        audienceValidator
    ));

    return decoder;
}

// Option 2: Symmetric secret (simpler, no key rotation — for internal services only):
@Bean
public JwtDecoder jwtDecoderSymmetric(@Value("${jwt.secret}") String secret) {
    SecretKeySpec key = new SecretKeySpec(secret.getBytes(), "HmacSHA256");
    return NimbusJwtDecoder.withSecretKey(key).build();
}
```

**Always validate the `aud` (audience) claim.** A JWT issued for `frontend-app` should not be valid for `order-service`. Without audience validation, any service that trusts the same Auth Server can use tokens issued for other services — a privilege escalation vulnerability.

## Method-Level Security

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    // Anyone with ROLE_USER or ROLE_ADMIN can read:
    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('USER', 'ADMIN')")
    public ResponseEntity<OrderDto> getOrder(@PathVariable Long id,
                                              Authentication auth) {
        return ResponseEntity.ok(orderService.findById(id));
    }

    // Only ADMIN can delete:
    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> deleteOrder(@PathVariable Long id) {
        orderService.delete(id);
        return ResponseEntity.noContent().build();
    }

    // User can only see their own orders (SpEL expression):
    @GetMapping("/my-orders")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<List<OrderDto>> getMyOrders(Authentication auth) {
        String userId = auth.getName();  // Subject from JWT
        return ResponseEntity.ok(orderService.findByUserId(userId));
    }

    // Complex rule: Admin can view any order; user can view only their own:
    @GetMapping("/{id}/details")
    @PreAuthorize("hasRole('ADMIN') or @orderSecurity.isOwner(authentication, #id)")
    public ResponseEntity<OrderDetailsDto> getOrderDetails(@PathVariable Long id) {
        return ResponseEntity.ok(orderService.getDetails(id));
    }
}

// Custom security bean for complex rules:
@Component("orderSecurity")
public class OrderSecurityService {

    @Autowired
    private OrderRepository orderRepository;

    public boolean isOwner(Authentication auth, Long orderId) {
        String currentUserId = auth.getName();
        return orderRepository.findById(orderId)
            .map(order -> order.getUserId().equals(currentUserId))
            .orElse(false);
    }
}
```

## Extracting the Authenticated User

```java
// Method 1: Authentication parameter (Spring injects automatically):
@GetMapping("/profile")
public ResponseEntity<UserProfile> getProfile(Authentication auth) {
    Jwt jwt = (Jwt) auth.getPrincipal();
    String userId = jwt.getSubject();           // 'sub' claim
    String email = jwt.getClaimAsString("email");
    List<String> roles = jwt.getClaimAsStringList("roles");
    return ResponseEntity.ok(userService.getProfile(userId));
}

// Method 2: @AuthenticationPrincipal annotation:
@GetMapping("/profile")
public ResponseEntity<UserProfile> getProfile(@AuthenticationPrincipal Jwt jwt) {
    String userId = jwt.getSubject();
    // ... same as above, cleaner signature
}

// Method 3: SecurityContextHolder (for non-controller code):
public String getCurrentUserId() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth instanceof JwtAuthenticationToken jwtAuth) {
        return jwtAuth.getToken().getSubject();
    }
    throw new IllegalStateException("No authenticated user in context");
}

// Custom annotation for cleaner controller signatures:
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
@AuthenticationPrincipal(expression = "subject")  // Extract 'sub' directly
public @interface CurrentUserId {}

// Usage:
@GetMapping("/profile")
public ResponseEntity<UserProfile> getProfile(@CurrentUserId String userId) {
    return ResponseEntity.ok(userService.getProfile(userId));
}
```

## Custom UserDetailsService with Database Lookup

When using username/password authentication (not OAuth2 external IdP):

```java
@Service
public class CustomUserDetailsService implements UserDetailsService {

    @Autowired
    private UserRepository userRepository;

    @Override
    @Transactional(readOnly = true)
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        User user = userRepository.findByEmail(email)
            .orElseThrow(() -> new UsernameNotFoundException("User not found: " + email));

        if (!user.isEnabled()) {
            throw new DisabledException("Account disabled");
        }

        return org.springframework.security.core.userdetails.User.builder()
            .username(user.getId().toString())  // Use ID as username (avoids email exposure)
            .password(user.getPasswordHash())
            .authorities(user.getRoles().stream()
                .map(role -> new SimpleGrantedAuthority("ROLE_" + role.name()))
                .collect(Collectors.toList()))
            .accountExpired(false)
            .accountLocked(user.isLocked())
            .credentialsExpired(false)
            .disabled(!user.isEnabled())
            .build();
    }
}

@Configuration
public class PasswordConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        // BCrypt with cost factor 12 (default is 10):
        // Higher = more CPU per hash = harder to brute force
        return new BCryptPasswordEncoder(12);
    }
}
```

## JWT Token Issuing (Authorization Server Side)

If you're building your own token endpoint (not using an external IdP):

```java
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired private AuthenticationManager authenticationManager;
    @Autowired private JwtService jwtService;
    @Autowired private RefreshTokenService refreshTokenService;

    @PostMapping("/login")
    public ResponseEntity<TokenResponse> login(@Valid @RequestBody LoginRequest request) {
        Authentication auth = authenticationManager.authenticate(
            new UsernamePasswordAuthenticationToken(request.getEmail(), request.getPassword())
        );

        UserDetails user = (UserDetails) auth.getPrincipal();
        String accessToken = jwtService.generateAccessToken(user);
        String refreshToken = refreshTokenService.createRefreshToken(user.getUsername());

        return ResponseEntity.ok(new TokenResponse(accessToken, refreshToken));
    }

    @PostMapping("/refresh")
    public ResponseEntity<TokenResponse> refresh(@RequestBody RefreshRequest request) {
        RefreshToken token = refreshTokenService.findByToken(request.getRefreshToken())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid refresh token"));

        if (token.isExpired()) {
            refreshTokenService.delete(token);
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Refresh token expired");
        }

        // Rotation: invalidate old refresh token, issue new one:
        refreshTokenService.delete(token);
        String newRefreshToken = refreshTokenService.createRefreshToken(token.getUserId());
        String newAccessToken = jwtService.generateAccessToken(token.getUserId());

        return ResponseEntity.ok(new TokenResponse(newAccessToken, newRefreshToken));
    }
}

@Service
public class JwtService {

    @Value("${jwt.secret}")
    private String secret;

    @Value("${jwt.expiry-seconds:900}")  // 15 minutes default
    private long expirySeconds;

    public String generateAccessToken(UserDetails user) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("roles", user.getAuthorities().stream()
            .map(GrantedAuthority::getAuthority)
            .map(r -> r.replace("ROLE_", ""))
            .collect(Collectors.toList()));

        return Jwts.builder()
            .setClaims(claims)
            .setSubject(user.getUsername())
            .setIssuedAt(new Date())
            .setExpiration(new Date(System.currentTimeMillis() + expirySeconds * 1000))
            .setIssuer("https://api.example.com")
            .setAudience("order-service")
            .signWith(Keys.hmacShaKeyFor(secret.getBytes()), SignatureAlgorithm.HS256)
            .compact();
    }
}
```

## Security Pitfalls

**1. Algorithm confusion attack (alg=none)**

```java
// VULNERABLE: trusting the 'alg' header from the token itself
// An attacker sets alg=none in the JWT header → no signature verification

// SAFE: Use a typed decoder that enforces the algorithm:
NimbusJwtDecoder decoder = NimbusJwtDecoder
    .withJwkSetUri("...")
    .jwsAlgorithm(SignatureAlgorithm.RS256)  // Enforce RS256 only
    .build();
```

**2. Missing audience validation**

```java
// VULNERABLE: Any service trusting the same IdP accepts this token
// SAFE: Validate 'aud' claim (shown above in jwtDecoder() configuration)
```

**3. Sensitive data in JWT payload**

```java
// JWT payload is Base64-encoded, NOT encrypted — anyone can decode it
// Never put in JWT payload:
// - Passwords (obviously)
// - PII beyond user ID
// - Internal system IDs that reveal architecture
// - Anything you don't want logged when tokens are logged

// JWT payload is visible to the client and any intermediate proxy:
String payload = new String(Base64.getDecoder().decode(token.split("\\.")[1]));
// → {"sub":"user123","roles":["USER"],"email":"alice@example.com"}
```

**4. Long-lived access tokens**

```
Access token lifetime: 15 minutes (recommended for sensitive operations)
Refresh token lifetime: 7-30 days

Short access tokens limit the window of exposure if stolen.
Refresh tokens enable staying logged in without re-authentication.
Refresh token rotation (issue new refresh token on each use) limits replay attacks.
```

**5. CORS misconfiguration allowing any origin**

```java
// VULNERABLE:
.cors(cors -> cors.configurationSource(request -> {
    CorsConfiguration config = new CorsConfiguration();
    config.addAllowedOrigin("*");  // ANY origin — allows cross-site token theft
    config.addAllowedHeader("*");
    config.addAllowedMethod("*");
    return config;
}))

// SAFE: Explicit allowed origins only:
.cors(cors -> cors.configurationSource(request -> {
    CorsConfiguration config = new CorsConfiguration();
    config.setAllowedOrigins(List.of("https://app.example.com", "https://admin.example.com"));
    config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
    config.setAllowedHeaders(List.of("Authorization", "Content-Type"));
    config.setAllowCredentials(true);
    config.setMaxAge(3600L);
    return config;
}))
```

Spring Security's layered defense — filter chain, method security, CORS configuration, JWT validation — is effective when each layer is properly configured. The common failure mode is not in individual configuration items but in the gaps: a misconfigured audience validator, a wildcard CORS origin, an overly long token lifetime. Review each configuration decision against the threat model for your specific application.
