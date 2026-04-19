---
title: "Floyd-Warshall Algorithm in Java: All-Pairs Shortest Paths"
description: "Master the Floyd-Warshall algorithm in Java. Learn how to find the shortest distances between all pairs of vertices in a weighted graph, including those with negative edge weights."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "graph", "shortest path", "floyd-warshall", "dynamic programming", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

While Dijkstra's algorithm finds the shortest path from a *single source* to all other nodes, the **Floyd-Warshall algorithm** finds the shortest paths between **all pairs** of vertices in a weighted graph.

It is a classic example of **Dynamic Programming** applied to graphs.

## The Core Concept: Iterative Intermediate Nodes

The algorithm works by gradually allowing more vertices to be used as "intermediate" nodes on a path.

**The Logic**:
1. Initialize a 2D `dist` matrix where `dist[i][j]` is the weight of the edge from `i` to `j`. If no edge exists, use `Infinity`.
2. For every vertex `k` (the intermediate node):
   - For every vertex `i` (the start node):
     - For every vertex `j` (the end node):
       - If `dist[i][k] + dist[k][j] < dist[i][j]`, then update `dist[i][j] = dist[i][k] + dist[k][j]`.

Essentially, we ask: "Is it shorter to go from `i` to `j` directly, or by passing through vertex `k`?"

---

## Floyd-Warshall Implementation in Java

```java
import java.util.Arrays;

public class FloydWarshall {
    private static final int INF = 1000000; // Using a large value instead of Integer.MAX_VALUE to avoid overflow

    public int[][] allPairsShortestPath(int n, int[][] graph) {
        int[][] dist = new int[n][n];

        // 1. Initialize distance matrix
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if (i == j) dist[i][j] = 0;
                else if (graph[i][j] != 0) dist[i][j] = graph[i][j];
                else dist[i][j] = INF;
            }
        }

        // 2. Main 3-layer loop (The DP core)
        for (int k = 0; k < n; k++) {
            for (int i = 0; i < n; i++) {
                for (int j = 0; j < n; j++) {
                    if (dist[i][k] + dist[k][j] < dist[i][j]) {
                        dist[i][j] = dist[i][k] + dist[k][j];
                    }
                }
            }
        }

        return dist;
    }
}
```

---

## When to use Floyd-Warshall?

| Feature | Floyd-Warshall | Dijkstra |
|---|---|---|
| **Goal** | All-Pairs Shortest Path | Single-Source Shortest Path |
| **Negative Weights** | Works (unless there's a negative cycle) | Does not work |
| **Complexity** | $O(V^3)$ | $O(E \log V)$ per source |
| **Graph Density** | Better for dense graphs | Better for sparse graphs |

## Detecting Negative Cycles

Floyd-Warshall can also be used to detect negative cycles. After the algorithm completes, if any `dist[i][i] < 0`, it means vertex `i` is part of a negative cycle.

## Summary

Floyd-Warshall is the most comprehensive way to understand a graph's connectivity and distances. Although its $O(V^3)$ complexity makes it expensive for very large graphs, its simplicity and ability to handle negative weights make it a staple in any algorithmist's toolkit. It perfectly demonstrates how a nested structure of subproblems can solve global optimization challenges.
