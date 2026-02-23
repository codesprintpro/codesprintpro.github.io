---
title: "Java Memory Management Deep Dive: Heap, GC, and Production Tuning"
description: "How the JVM allocates memory, how G1GC and ZGC work under the hood, heap analysis with JVM tools, and the GC tuning decisions that eliminate latency spikes in production Java services."
date: "2025-06-13"
category: "Java"
tags: ["java", "jvm", "garbage collection", "g1gc", "zgc", "heap", "memory management", "performance"]
featured: false
affiliateSection: "java-courses"
---

Java's garbage collector is the single biggest source of unexplained latency spikes in production services. A GC pause of 2 seconds is invisible in most logs but visible to every user who happened to make a request during that window. Understanding how memory is managed — from object allocation to heap regions to collector algorithms — is not optional for engineers running Java at scale.

## JVM Memory Layout

```
JVM Process Memory:
┌─────────────────────────────────────────────────────────┐
│  Java Heap                                              │
│  ┌─────────────────────┐  ┌──────────────────────────┐  │
│  │  Young Generation   │  │   Old Generation         │  │
│  │  ┌──────┐ ┌──────┐  │  │  (long-lived objects)    │  │
│  │  │Eden  │ │Surv  │  │  │                          │  │
│  │  │Space │ │ivor  │  │  │                          │  │
│  │  │      │ │Spaces│  │  │                          │  │
│  │  └──────┘ └──────┘  │  │                          │  │
│  └─────────────────────┘  └──────────────────────────┘  │
│                                                         │
│  Metaspace (class metadata — NOT in heap)              │
│  Thread Stacks (one per thread, outside heap)           │
│  Code Cache (JIT compiled code)                         │
│  Direct Memory (ByteBuffer.allocateDirect)              │
└─────────────────────────────────────────────────────────┘
```

**Object lifecycle:**
1. New objects allocated in **Eden** (fast, bump-pointer allocation)
2. Minor GC: surviving Eden objects copied to Survivor spaces
3. Objects surviving multiple minor GCs promoted to **Old Generation**
4. Major (Full) GC: collects Old Generation — expensive, may pause

**Why most objects die young:** In a typical Spring Boot service, the vast majority of objects are request-scoped: HttpServletRequest, method parameters, response DTOs. They're allocated in Eden and die before the next minor GC. This is the "generational hypothesis" and why young-generation collection is cheap.

## G1GC: How It Works

G1 (Garbage First) replaced CMS as the default GC in JDK 9. It divides the heap into equal-sized regions (typically 1-32MB each) rather than fixed young/old spaces:

```
G1 Heap Regions (each ~16MB with -XX:G1HeapRegionSize=16m):

[E][E][E][E][E][E][E][E]  ← Eden regions (active allocation)
[S][S]                    ← Survivor regions (recently promoted)
[O][O][O][O][O][O][O][O]  ← Old regions (long-lived)
[H]                       ← Humongous region (objects > 50% of region size)
[ ][ ][ ][ ]              ← Free regions
```

**G1 collection phases:**
1. **Young GC (stop-the-world):** Evacuates Eden + Survivor regions to new Survivor/Old regions
2. **Concurrent Marking:** Marks live objects in Old regions concurrently with application threads
3. **Mixed GC:** Collects Young regions + the Old regions with most garbage (Garbage First = collect highest-garbage regions first)

**Why G1 can miss pause targets:** If promotion is too fast (too many objects promoted to Old), G1 cannot run concurrent marking fast enough. When Old region occupancy exceeds `InitiatingHeapOccupancyPercent`, G1 starts concurrent marking. If it can't finish before Old gen fills up, a Full GC (single-threaded Stop-The-World) occurs.

## ZGC: Sub-Millisecond Pauses

ZGC (available since JDK 15, production-ready in JDK 17) achieves sub-millisecond pause times by doing almost all work concurrently:

```
ZGC vs G1GC pause times (16GB heap, 4-core server):
G1GC: Minor GC 10-50ms, Major GC 200ms-2s
ZGC:  All GC pauses < 1ms (even at 1TB heap)
```

ZGC achieves this using **colored pointers** (metadata encoded in object references) and **load barriers** (code inserted at every object read that checks and fixes pointer state). This moves GC work from stop-the-world pauses into the application thread's critical path — you pay a steady ~5-10% throughput overhead instead of occasional large pauses.

**When to use ZGC:**
- P99/P999 latency requirements (< 100ms SLOs)
- Large heaps (> 8GB) where G1 pause times grow
- Interactive services where pauses are user-visible

**When to stick with G1GC:**
- Throughput-optimized batch processing
- Small heaps (< 4GB) where G1 pauses are already < 50ms
- JDK 11 environments (ZGC not production-ready)

## GC Tuning Configuration

```bash
# G1GC for latency-sensitive services:
-XX:+UseG1GC
-Xms8g -Xmx8g                              # Fixed heap size (no resizing pauses)
-XX:MaxGCPauseMillis=100                    # Target: 100ms max pause
-XX:G1HeapRegionSize=16m                    # For 8GB heap: 512 regions
-XX:InitiatingHeapOccupancyPercent=35       # Start concurrent marking earlier
-XX:ConcGCThreads=4                         # Concurrent marking threads = CPU/4
-XX:ParallelGCThreads=8                     # Parallel GC threads = CPU
-XX:+ParallelRefProcEnabled                 # Parallel reference processing
-XX:G1RSetUpdatingPauseTimePercent=10

# ZGC for ultra-low latency:
-XX:+UseZGC
-Xms8g -Xmx8g
-XX:ZCollectionInterval=5                  # Force GC every 5 seconds if idle
-XX:ZUncommitDelay=300                     # Return memory to OS after 5 min idle
# No MaxGCPauseMillis — ZGC handles this automatically

# Memory regions (both GCs):
-XX:MetaspaceSize=256m
-XX:MaxMetaspaceSize=512m
-XX:ReservedCodeCacheSize=256m

# GC logging for production diagnosis:
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level:filecount=5,filesize=20m
```

## Identifying GC Problems

**Tool 1: jstat — real-time GC monitoring**
```bash
jstat -gcutil <pid> 1000   # Print every 1 second

# Output columns:
# S0    S1    E     O     M     CCS   YGC  YGCT  FGC  FGCT   CGC  CGCT   GCT
# 0.00  42.31 78.92 45.12 93.45 89.23 1847 12.431   2  3.241    0  0.000 15.672

# S0/S1: Survivor space utilization
# E:     Eden utilization
# O:     Old gen utilization
# YGC:   Young GC count  YGCT: Young GC total time
# FGC:   Full GC count   FGCT: Full GC total time (2 full GCs = ALERT)
```

**Tool 2: GC log analysis**
```bash
# Parse GC log for pause time distribution:
grep "Pause" gc.log | awk '{print $NF}' | sort -n | awk '
BEGIN { count=0; sum=0 }
{ times[count++] = $1; sum += $1 }
END {
    print "Count:", count
    print "Avg:", sum/count "ms"
    print "P95:", times[int(count*0.95)] "ms"
    print "P99:", times[int(count*0.99)] "ms"
    print "Max:", times[count-1] "ms"
}'
```

**Tool 3: Heap dump analysis with Eclipse MAT**
```bash
# Trigger heap dump on OOM:
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof

# Manual heap dump:
jmap -dump:format=b,file=/tmp/heap.hprof <pid>

# Or via JCmd (safer for running processes):
jcmd <pid> GC.heap_dump /tmp/heap.hprof
```

In Eclipse MAT, look at:
- **Dominator Tree:** Objects retaining the most heap — often reveals caches or collections that grew unchecked
- **Leak Suspects:** MAT's automated analysis of probable memory leaks
- **Top Consumers:** Classes with the most instances

## Common Memory Problems

**Problem 1: Old Gen growing to 100% → Full GC**

Cause: Objects promoted to Old Gen faster than GC can collect them.

Diagnosis: `jstat` shows O% growing monotonically. `jmap -histo <pid>` shows which classes have millions of instances.

Fix: Usually a cache without size/TTL limits, or a large static collection.

```java
// BAD: Unbounded cache
private static final Map<String, UserProfile> cache = new HashMap<>();

// GOOD: Size-bounded cache with eviction
private static final Map<String, UserProfile> cache = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(Duration.ofMinutes(30))
    .build()
    .asMap();
```

**Problem 2: Humongous object allocations causing GC pressure**

Objects larger than 50% of a G1 region size (typically 8MB+) go directly to Humongous regions and skip Young Gen entirely. Frequent large allocations cause GC pressure.

```bash
# Detect humongous allocations:
-Xlog:gc+humongous=debug:file=gc.log
# Shows: "Humongous region X to Y (Z regions)"
```

Fix: Avoid large temporary arrays. Stream large data in chunks. Re-use byte buffers with `ByteBuffer.allocateDirect`.

**Problem 3: Excessive finalization queue depth**

Objects with `finalize()` methods (mostly legacy code or certain libraries) must wait for the finalizer thread before their memory is reclaimed. Under GC pressure, the finalization queue can grow unboundedly.

```bash
jmap -histo:live <pid> | grep Finalizable
# If count is growing: finalizer thread is falling behind
```

## Memory Profiling in Production with JFR

Java Flight Recorder has negligible overhead (<1%) and is safe for production:

```bash
# Start a 60-second recording:
jcmd <pid> JFR.start duration=60s filename=/tmp/recording.jfr settings=profile

# Key events to analyze in JDK Mission Control:
# - GC configuration and pause times
# - Object allocation by class (top allocators)
# - Thread profiling (method-level)
# - Lock contention
```

JFR allocation profiling shows you exactly which call sites are allocating the most objects — far more actionable than heap dumps for performance optimization.

## JVM Ergonomics and Container Awareness

In containers, the JVM must know the container's memory limit, not the host's total RAM:

```bash
# JDK 10+ auto-detects container limits:
# No explicit -Xmx needed when running in container with limits set

# But verify:
java -XX:+PrintFlagsFinal -version 2>/dev/null | grep MaxHeapSize
# Should be ~25% of container memory limit (default ergonomics)

# Override if needed:
-XX:MaxRAMPercentage=75.0    # Use 75% of container RAM for heap
# Better than hard-coded -Xmx in containerized environments
```

For Kubernetes pods with `memory.limit=2Gi`:
```bash
-XX:MaxRAMPercentage=75.0   # Heap = 1.5GB
# Leaves 512MB for: Metaspace (~200MB), thread stacks (~100MB),
# direct memory, code cache — sufficient.
```
