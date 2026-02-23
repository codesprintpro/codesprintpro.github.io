---
title: "Java GC Tuning: From G1 to ZGC — Eliminating Pause-Time Spikes"
description: "Master Java garbage collection tuning. Understand G1GC, ZGC, and Shenandoah internals, diagnose GC issues from logs, and apply production tuning flags to eliminate pause-time spikes."
date: "2025-02-22"
category: "Java"
tags: ["java", "gc", "performance", "jvm", "g1gc", "zgc", "tuning"]
featured: false
affiliateSection: "java-courses"
---

Garbage collection pauses are the invisible killer of Java application latency. A service with p99 latency of 20ms can suddenly spike to 500ms because GC paused all threads for a full collection. Understanding GC internals — not just tuning flags — is what separates engineers who eliminate GC pauses from those who keep adding heap and hoping.

## The Generational Hypothesis

All production JVM GCs exploit the **generational hypothesis**: most objects die young. A freshly allocated `HttpRequest` object, a `StringBuilder` built for one response, a DTO for one API call — these live for milliseconds. To see why this insight is so powerful, consider the typical shape of object lifetimes in a real Java web service:

```
Object lifetime distribution (typical Java web service):

 Count
   │
   █
   █ █
   █ █ █
   █ █ █ █                    ·
   █ █ █ █ █                · · ·
   ──────────────────────────────────── Age
   <1ms           <1s            Long-lived

99% of objects die in the first few milliseconds.
~1% survive to become long-lived (caches, thread pools, connection pools).
```

The steep drop-off in that chart is what makes generational collection efficient: the JVM can reclaim the vast majority of memory by scanning only the small, recently-allocated portion of the heap. This is why JVMs divide the heap into generations:
- **Young Generation (Eden + Survivor spaces)**: New objects allocated here. Minor GC runs frequently (~seconds) and is fast (~10ms)
- **Old Generation (Tenured)**: Objects that survive enough minor GCs are promoted here. Major/Full GC runs rarely but can pause for seconds

## G1GC: The Default Since Java 9

G1 (Garbage First) divides the heap into equal-sized regions (~2MB each) rather than fixed young/old spaces. It predicts which regions have the most garbage and collects those first — hence "Garbage First." The diagram below shows how regions are dynamically assigned roles, which lets G1 balance collection work without requiring you to manually size each generation:

```
G1 Heap Layout:
  ┌───┬───┬───┬───┬───┬───┬───┬───┐
  │ E │ E │ S │ S │ O │ O │ O │ H │  E=Eden, S=Survivor
  ├───┼───┼───┼───┼───┼───┼───┼───┤  O=Old, H=Humongous
  │ E │ O │ O │ E │ O │ S │ H │ E │
  ├───┼───┼───┼───┼───┼───┼───┼───┤
  │ O │ O │ E │ E │ O │ O │ O │ O │
  └───┴───┴───┴───┴───┴───┴───┴───┘

G1 collects whichever regions have highest garbage ratio first.
Regions dynamically reassigned as young/old based on need.
```

### Key G1 JVM Flags

The following flags give you a solid starting configuration for G1 on a production service. The most important one to understand is `MaxGCPauseMillis` — it is a *soft target*, meaning G1 uses it as a goal when deciding how much work to do per cycle, but it cannot always guarantee it will be met under extreme heap pressure:

```bash
# Target: pause < 200ms, heap = 8GB
-XX:+UseG1GC                          # Default since Java 9 — usually don't need to specify
-Xms8g -Xmx8g                         # Set min = max to avoid resize pauses
-XX:MaxGCPauseMillis=200              # G1 soft target (not guaranteed)
-XX:G1HeapRegionSize=16m              # Larger regions for large heaps (up to 32MB)
-XX:G1NewSizePercent=20               # Min young gen = 20% of heap
-XX:G1MaxNewSizePercent=40            # Max young gen = 40% of heap
-XX:G1MixedGCCountTarget=8           # Number of mixed GC cycles
-XX:G1HeapWastePercent=5             # Don't collect if less than 5% is reclaimable
-XX:InitiatingHeapOccupancyPercent=45 # Start concurrent marking at 45% heap usage
-XX:+G1UseAdaptiveIHOP               # Adaptive IHOP (Java 9+)
```

### Reading GC Logs

Flags alone won't help you if you can't observe what GC is actually doing. Always enable GC logging in production — the overhead is negligible and the diagnostic value is enormous:

```bash
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=20m
```

Sample output:
```
[2025-02-20T10:15:32.045+0000][2.345s][info][gc] GC(42) Pause Young (Normal) (G1 Evacuation Pause) 2048M->512M(8192M) 45.234ms
[2025-02-20T10:15:35.891+0000][5.191s][info][gc] GC(43) Pause Young (Normal) (G1 Evacuation Pause) 1536M->400M(8192M) 38.102ms
[2025-02-20T10:15:50.123+0000][19.423s][warning][gc] GC(44) To-space exhausted
[2025-02-20T10:15:50.234+0000][19.534s][info][gc] GC(44) Pause Full (G1 Compaction Pause) 7800M->2100M(8192M) 4523.891ms
```

The `4523.891ms` Full GC in the last line is a 4.5-second stop-the-world pause — the kind of spike that will blow through any reasonable latency SLA. Learning to recognize the warning signs before that happens is the key skill.

**Red flags in GC logs:**
- `To-space exhausted` → Survivor spaces too small, objects forced to Old Gen prematurely
- `Pause Full` → Full GC triggered — expensive, caused by heap exhaustion or humongous object allocation failure
- `Evacuation Failure` → GC couldn't evacuate young gen → heap pressure
- Pause time consistently > `MaxGCPauseMillis` target → Heap too small or mixed GC tuning needed

### Common G1 Issues and Fixes

Once you know how to read the logs, the next step is mapping the symptoms you see to the right corrective action. Each of the three scenarios below has a distinct cause and a specific set of flags or code changes that address it:

```
Issue: Humongous Object Allocation
  Objects > 50% of region size (>8MB for 16MB regions) are allocated directly in Old Gen.
  If short-lived, they skip Young Gen and pollute Old Gen.

Fix:
  1. Increase G1HeapRegionSize to make more objects "normal" size
  2. Identify culprits: -XX:+G1PrintRegionRememberedSetInfo (Java 11+)
  3. Refactor: stream large byte arrays instead of materializing them

Issue: Old Gen fills up → Full GC
  Mixed GC isn't reclaiming Old Gen fast enough.

Fix:
  -XX:G1MixedGCCountTarget=4          # More frequent mixed GC
  -XX:G1HeapWastePercent=1            # Collect more aggressively
  -XX:InitiatingHeapOccupancyPercent=35 # Start concurrent marking earlier

Issue: Long Young GC pauses
  Too many live objects in Young Gen → evacuation takes long.

Fix:
  -XX:G1NewSizePercent=10             # Smaller young gen = faster minor GC
  -XX:MaxTenuringThreshold=3          # Promote to Old Gen sooner
```

## ZGC: Sub-Millisecond Pauses (Java 15+)

If G1 tuning still leaves you with pauses that violate your latency requirements, ZGC offers a fundamentally different trade-off. ZGC is a concurrent collector — it does almost all work while application threads run. Stop-the-world pauses are limited to root scanning and reference processing, typically **< 1ms** even on 100GB+ heaps. The trade-off is that it requires more heap headroom and uses more CPU for its background collection work. Here is a recommended baseline configuration:

```bash
# ZGC configuration
-XX:+UseZGC                     # Enable ZGC
-Xms16g -Xmx16g                 # ZGC needs generous heap headroom (~2-3x live set)
-XX:SoftMaxHeapSize=14g         # Soft limit: ZGC starts collecting harder above this
-XX:ZCollectionInterval=0       # 0 = adaptive (recommended)
-XX:ConcGCThreads=4             # Concurrent GC threads (increase for large heaps)
-XX:+ZGenerational              # Java 21+: Generational ZGC (much better throughput)
```

The `ZGenerational` flag (Java 21+) is particularly important: it adds generational awareness to ZGC, dramatically improving throughput without sacrificing the sub-millisecond pause times that make ZGC appealing in the first place.

**ZGC tradeoffs:**
- Pause times: < 1ms ✓
- Throughput: 5-10% lower than G1 (concurrent work has CPU cost)
- Memory overhead: Higher (needs extra heap headroom ~2x)
- Best for: Latency-sensitive services (trading, real-time APIs) with large heaps

### G1 vs ZGC vs Shenandoah

Choosing between collectors comes down to understanding your own latency requirements and heap size. Use this table as a quick reference when deciding which collector is appropriate for a given service:

| | G1GC | ZGC (Java 21 Gen) | Shenandoah |
|---|---|---|---|
| Pause time | 50-500ms | < 1ms | < 10ms |
| Throughput | Excellent | Good (-5%) | Good (-5%) |
| Heap size | Any | Large (> 4GB benefits most) | Any |
| Memory overhead | Low | High (2x) | Medium |
| Java version | 9+ | 11+, Gen in 21+ | 12+ |
| Best for | Default choice | Latency-critical | Latency-sensitive |

## Diagnosing GC Problems in Production

Knowing which collector to use is only half the battle. When a GC problem surfaces in production, you need a repeatable diagnostic process to find the root cause without guessing. Follow these steps in order — measuring first prevents you from applying the wrong fix.

### Step 1: Measure before tuning

Start by quantifying how much of your CPU time is consumed by GC and which areas of the heap are under pressure. This gives you a baseline to compare against after any change you make:

```bash
# GC overhead: what % of CPU time is GC?
# Rule of thumb: > 5% GC CPU → GC is a problem
jstat -gcutil <pid> 1000 10
# Output: S0  S1  E   O   M   CCS  YGC  YGCT  FGC  FGCT  CGC  CGCT  GCT
#           0  50  80  45  95   90   42  0.845    0     0    3   0.234  1.079
# YGC=42 young GCs in measurement period, YGCT=total young GC time

# Heap histogram: what's consuming heap?
jmap -histo:live <pid> | head -30
# Lists: #instances, bytes, class name
# Look for: unexpected retention of Request/Response objects, large byte arrays
```

### Step 2: Heap dump analysis

If `jstat` shows high Old Gen occupancy or frequent Full GCs, the next step is a heap dump. A heap dump lets you see exactly which objects are being retained and why — this is how you find memory leaks:

```bash
# Trigger heap dump (OOM or manual)
jmap -dump:format=b,file=/tmp/heap.hprof <pid>

# Or configure JVM to dump on OOM
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/

# Analyze with Eclipse MAT or VisualVM
# Look for: Retained Heap (memory freed if object is GC'd)
# Find: Objects with large retained heap that shouldn't be alive
```

### Step 3: Allocation profiling

When your object lifetime distribution is healthy but GC is still frequent, the problem is usually allocation rate — your application is creating objects faster than GC can collect them. Allocation profiling pinpoints exactly which code paths are responsible:

```bash
# Async-profiler: low-overhead allocation profiling
./profiler.sh -e alloc -d 30 -f alloc.html <pid>

# Or JVM built-in (Java Flight Recorder)
java -XX:+FlightRecorder \
     -XX:StartFlightRecording=duration=60s,settings=profile,filename=recording.jfr \
     -jar app.jar
```

## Production Tuning Checklist

With all three diagnostic steps complete, you are ready to apply targeted configuration changes. The flags below represent a battle-tested starting point for a Java 21 web service, with comments explaining the intent behind each choice. Apply them incrementally and re-measure after each change so you can attribute improvements to specific flags:

```bash
# Base flags for any Java web service (Java 21)
-Xms4g -Xmx4g                              # Set min=max (avoid resize pauses)
-XX:+UseG1GC                               # Default, good starting point
-XX:MaxGCPauseMillis=200                   # Define your SLA
-XX:InitiatingHeapOccupancyPercent=35      # Earlier concurrent marking
-XX:+G1UseAdaptiveIHOP                     # Let JVM tune IHOP

# GC Logging (always on in production)
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=20m

# OOM handling
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
-XX:+ExitOnOutOfMemoryError                # Crash fast rather than limp

# For latency-sensitive services (Java 21)
-XX:+UseZGC -XX:+ZGenerational            # Switch to ZGC
-Xms16g -Xmx16g                           # Give ZGC headroom

# Avoid:
# -Xmn (manually setting young gen size) — let G1 manage it
# -XX:+UseConcMarkSweepGC — deprecated, removed in Java 14
# -XX:+UseSerialGC — only for single-CPU containers
```

The golden rule of GC tuning: **measure first, tune second**. Most GC problems are solved by either sizing the heap appropriately or identifying a memory leak. Only after ruling those out should you reach for GC flags.
