---
title: "Java Profiling and Heap Analysis: Finding Memory Leaks and CPU Bottlenecks"
description: "Production Java profiling: async-profiler for CPU and allocation profiling, heap dump analysis with Eclipse MAT, finding memory leaks, GC log analysis, detecting thread contention, JVM flags for profiling in production, and reading flame graphs."
date: "2025-05-09"
category: "Java"
tags: ["java", "profiling", "heap analysis", "memory leak", "jvm", "performance", "async-profiler", "gc"]
featured: false
affiliateSection: "java-courses"
---

Java applications in production develop performance problems that don't reproduce locally: memory that grows slowly until OOM, GC pauses that spike P99 latency, threads that contend on a lock under load. The difference between an engineer who fixes these problems in hours versus days is knowing which tool to use and how to read what it shows.

## The Profiling Toolkit

```
Problem type → Tool to use:
CPU bottleneck (high CPU, slow response)  → async-profiler (CPU mode)
Memory leak (OOM, growing heap)           → async-profiler (allocation) + heap dump + MAT
GC pressure (GC overhead, pauses)        → GC logs + GCViewer / GC Easy
Thread contention (lock waits, deadlock) → async-profiler (wall-clock mode) + thread dump
Latency spikes (P99 >> P50)              → async-profiler + distributed tracing
Startup performance                       → JVM startup flags + GraalVM profile
```

## async-profiler: Low-Overhead Production Profiling

[async-profiler](https://github.com/async-profiler/async-profiler) is the best production-safe profiler for JVM applications. It uses AsyncGetCallTrace (bypasses safepoints — true async sampling, no "safepoint bias" that makes synchronized code look fast) and perf_events for native stack frames.

**Installation and basic usage:**

```bash
# Download:
wget https://github.com/async-profiler/async-profiler/releases/download/v3.0/async-profiler-3.0-linux-x64.tar.gz
tar xzf async-profiler-3.0-linux-x64.tar.gz

# Find target JVM PID:
jps -l
# → 12345 com.example.OrderServiceApplication

# CPU profiling (30 seconds, flamegraph output):
./asprof -d 30 -f /tmp/cpu-profile.html 12345

# Allocation profiling (which code allocates the most memory):
./asprof -e alloc -d 30 -f /tmp/alloc-profile.html 12345

# Wall-clock profiling (including I/O and lock waits — not just CPU):
./asprof -e wall -d 30 -f /tmp/wall-profile.html 12345

# Lock profiling (find lock contention):
./asprof -e lock -d 30 -f /tmp/lock-profile.html 12345
```

**Reading a flame graph:**

```
Flame graph anatomy:

Y-axis: stack depth (bottom = thread entry, top = leaf frame where CPU is spent)
X-axis: time percentage (wider = more time spent in this frame and its callees)
Colors: arbitrary (but consistent — same function same color)

Wide frames at the TOP are the bottleneck.
Wide frames in the MIDDLE are code paths that lead to the bottleneck.

Example: Wide frame "HashMap.get()" at top of many stacks
→ All requests are spending time in HashMap.get()
→ Could be: GC resizing (too-small initial capacity)
→ Could be: Thread contention on a shared HashMap
→ Look at the frame below: what's calling HashMap.get()?
```

**JVM flags to enable profiling in production:**

```bash
# Add to JVM startup (low overhead, safe for production):
-XX:+UnlockDiagnosticVMOptions
-XX:+DebugNonSafepoints  # Required for async-profiler accuracy

# GC logging (essential — always enable in production):
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime:filecount=10,filesize=50m

# Enable JFR (Java Flight Recorder — built-in profiler, low overhead):
-XX:+FlightRecorder
-XX:StartFlightRecording=duration=120s,filename=/tmp/recording.jfr
```

## Heap Dump Analysis with Eclipse MAT

When memory grows and OOM is imminent, take a heap dump:

```bash
# On running JVM:
jmap -dump:live,format=b,file=/tmp/heap.hprof 12345
# "live" — only live objects (reachable from GC roots) — smaller, more useful

# On OOM (add to JVM flags — auto-dump on OOM):
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/tmp/heap-dumps/
# Creates heap-dump-<timestamp>.hprof on OOM

# Compress heap dump for transfer (heap dumps are large):
gzip /tmp/heap.hprof  # 10GB dump → ~2GB compressed
```

**Eclipse MAT analysis workflow:**

```
1. Open heap.hprof in Eclipse MAT

2. Overview tab: pie chart of object sizes
   → Look for: one class consuming disproportionate heap (> 20%)

3. Leak Suspects report (MAT auto-generates):
   → "One instance of com.example.RequestContext occupies 2.4GB (85%)"
   → This is your leak

4. Dominator Tree: shows objects that retain the most heap
   → Find the largest retained size objects
   → Expand: what's inside? Why is it still referenced?

5. Histogram: list all object types by count and size
   → Filter by count: char[] and byte[] at top = normal (String internals)
   → "HashMap$Entry × 5,000,000" = possibly a growing cache / map

6. Paths to GC Roots: for a suspicious object, find what keeps it alive
   → Right-click object → "Merge Shortest Paths to GC Roots"
   → Shows the chain of references keeping this object in memory
```

**Common memory leak patterns:**

```java
// Pattern 1: Static map used as cache (never evicts)
public class ProductService {
    private static final Map<Long, Product> cache = new HashMap<>();

    public Product getProduct(long id) {
        return cache.computeIfAbsent(id, productRepo::findById);
        // Problem: cache grows forever — every product ever queried is retained
    }
}
// Fix: Use Caffeine or Guava Cache with size limit and TTL

// Pattern 2: Event listener not deregistered
public class EventProcessor {
    @Autowired
    private EventBus eventBus;

    @PostConstruct
    public void init() {
        eventBus.register(this);  // Registers listener
        // Problem: if EventProcessor is prototype-scoped and created many times,
        // each instance is retained by eventBus forever → memory leak
    }

    @PreDestroy
    public void cleanup() {
        eventBus.unregister(this);  // Fix: always deregister on destroy
    }
}

// Pattern 3: ThreadLocal not cleaned up
public class TenantContext {
    private static final ThreadLocal<String> tenant = new ThreadLocal<>();

    public static void set(String id) { tenant.set(id); }
    public static String get() { return tenant.get(); }

    // Missing: clear() called after request completes
    // In a thread pool, threads are reused — ThreadLocal carries value to next request
    // If value is a large object: memory leak across requests
    public static void clear() { tenant.remove(); }  // Must be called in finally block
}
```

## GC Log Analysis

GC logs reveal pause patterns, GC frequency, and heap sizing problems:

```bash
# GC log enabled (JVM 11+ format):
-Xlog:gc*:file=/var/log/gc.log:time,uptime

# Sample GC log output:
[2025-01-15T10:23:45.123+0000][1234.567s] GC(42) Pause Young (Normal) (G1 Evacuation Pause)
  Eden: 512M->0M(512M)  Survivors: 32M->64M  Heap: 2048M->1536M(4096M)
  User=0.450s Sys=0.020s Real=0.047s  ← 47ms pause — check if this is acceptable

# Problematic patterns to look for:
# 1. "Pause Full" (stop-the-world full GC) → heap too small or memory leak
# 2. GC frequency increasing → heap filling faster over time (leak)
# 3. Heap after GC increasing each time → objects surviving that shouldn't
# 4. Very long pauses (> 500ms) → GC tuning needed
```

**GC visualization with GCViewer:**

```bash
# Parse GC log and show graphical analysis:
java -jar gcviewer.jar /var/log/gc.log
# Shows: pause time histogram, heap usage over time, GC throughput %
```

**Key GC metrics in Micrometer (Spring Boot Actuator):**

```
jvm.gc.pause{action="end of minor GC", cause="G1 Evacuation Pause"}
jvm.gc.memory.allocated  ← Allocation rate (bytes/second)
jvm.gc.memory.promoted   ← Old gen promotion rate
jvm.memory.used{area="heap"}

Alert thresholds:
GC pause > 200ms (95th percentile) → investigate
GC time > 5% of total time → heap sizing issue
Old gen > 80% after full GC → potential memory leak
```

## Thread Dump Analysis

For hung applications and deadlocks:

```bash
# Take thread dump:
jstack 12345 > /tmp/threads.txt

# Or via JVM signal:
kill -3 12345  # Prints thread dump to stdout (redirected from service logs)

# Thread dump shows each thread's state and stack:
"http-nio-8080-exec-42" #154 daemon prio=5
   java.lang.Thread.State: BLOCKED (on object monitor)
   → waiting to lock <0x00000006c0987a80> (a java.util.HashMap)
   → held by "http-nio-8080-exec-3"

# This indicates: two request threads contending on a shared HashMap
# exec-3 holds the lock, exec-42 is waiting
# Fix: use ConcurrentHashMap or move to per-request scope
```

**fastthread.io:** Upload thread dump for automated analysis — identifies deadlocks, blocked threads, and contention patterns.

## CPU Profiling: Case Study

Scenario: order service P99 latency jumped from 80ms to 800ms after a deploy. No OOM, memory looks fine.

```bash
# 1. Capture CPU flame graph:
./asprof -d 60 -f /tmp/cpu.html $(pgrep -f OrderService)

# 2. Open flame graph, look for wide top frames:
# Found: 40% of CPU time in:
#   com.example.OrderService.calculateTotals
#   → java.util.stream.Stream.sorted()
#   → java.util.Arrays.mergeSort()

# This is suspicious — why is sort taking 40% of CPU?

# 3. Check the code:
public BigDecimal calculateTotals(List<OrderItem> items) {
    return items.stream()
        .sorted(Comparator.comparing(OrderItem::getPrice).reversed())  // ← sorting each time
        .map(OrderItem::getPrice)
        .reduce(BigDecimal.ZERO, BigDecimal::add);
}
```

The bug: `sorted()` was added "for display purposes" but calculateTotals doesn't need sorted items. The sort is O(n log n) per call. At 1,000 calls/second on a list of 100 items — enormous wasted work.

Fix: remove the sort. P99 drops back to 85ms.

The tooling only reveals what you're looking for. But the pattern is consistent: CPU flame graph points to the hot function; code review explains why it's hot. async-profiler + 30 seconds of sampling + MAT for memory — these tools find in minutes what weeks of log analysis won't.
