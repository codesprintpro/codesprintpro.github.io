---
title: "Bellman-Ford Algorithm in Java: Shortest Paths with Negative Weights"
description: "Master the Bellman-Ford algorithm in Java. Learn how it handles negative edge weights and detects negative cycles in a weighted graph, and how it compares to Dijkstra."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "graph", "shortest path", "bellman-ford", "negative weights", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

While Dijkstra's algorithm is faster for most shortest-path problems, it fails when the graph contains **negative edge weights**. For those scenarios, we use the **Bellman-Ford algorithm**.

Not only does it handle negative weights, but it also has a built-in "security feature": it can detect **negative cycles** (a cycle where the sum of edge weights is negative).

## The Core Concept: Iterative Relaxation

Bellman-Ford works by "relaxing" every single edge in the graph $V-1$ times (where $V$ is the number of vertices).

**The Logic**:
1. Initialize `dist` array with `Infinity`, except `dist[source] = 0`.
2. Repeat $V-1$ times:
   - For every edge $(u, v)$ with weight $w$:
     - If `dist[u] + w < dist[v]`, update `dist[v] = dist[u] + w`.
3. To detect negative cycles:
   - Run the relaxation one more time. If any `dist[v]` can still be shortened, a negative cycle exists.

---

## Bellman-Ford Implementation in Java

```java
import java.util.*;

public class BellmanFord {
    static class Edge {
        int src, dest, weight;
        Edge(int s, int d, int w) { src = s; dest = d; weight = w; }
    }

    public int[] shortestPath(int n, List<Edge> edges, int startNode) {
        int[] dist = new int[n];
        Arrays.fill(dist, 1000000); // Using a large value instead of MAX_VALUE
        dist[startNode] = 0;

        // 1. Relax all edges n-1 times
        for (int i = 0; i < n - 1; i++) {
            for (Edge edge : edges) {
                if (dist[edge.src] != 1000000 && dist[edge.src] + edge.weight < dist[edge.dest]) {
                    dist[edge.dest] = dist[edge.src] + edge.weight;
                }
            }
        }

        // 2. Check for negative cycles
        for (Edge edge : edges) {
            if (dist[edge.src] != 1000000 && dist[edge.src] + edge.weight < dist[edge.dest]) {
                System.out.println("Graph contains a negative weight cycle!");
                return new int[0];
            }
        }

        return dist;
    }
}
```

---

## Bellman-Ford vs. Dijkstra

| Feature | Bellman-Ford | Dijkstra |
|---|---|---|
| **Edge Weights** | Handles Negative Weights | Only Non-Negative |
| **Cycle Detection** | Detects Negative Cycles | Fails on Negative Cycles |
| **Complexity** | $O(V \cdot E)$ | $O(E \log V)$ |
| **Best For** | Graphs with negative edges | Large graphs with positive edges |

## Why $V-1$ Iterations?

The longest possible shortest path in a graph with $V$ vertices (without cycles) can have at most $V-1$ edges. By relaxing all edges $V-1$ times, we guarantee that the shortest path information has propagated to all possible nodes. If an edge can still be relaxed after $V-1$ iterations, it must be because a negative cycle is reducing the distance infinitely.

## Summary

Bellman-Ford is a more robust, though slower, alternative to Dijkstra. It is essential for financial applications (like arbitrage detection) where negative values represent gains and cycles represent infinite loops of profit or loss. Understanding when to use it over Dijkstra is a common high-level interview question for backend engineers.
