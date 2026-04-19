---
title: "Kruskal's Algorithm in Java: Finding the Minimum Spanning Tree"
description: "Learn how to implement Kruskal's algorithm in Java. Understand how it uses the Greedy approach and Union-Find data structure to find the Minimum Spanning Tree (MST) of a graph."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "graph", "mst", "kruskal", "union find", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

Kruskal's algorithm is a famous **greedy** algorithm used to find the **Minimum Spanning Tree (MST)** of a connected, weighted, and undirected graph.

An MST is a subset of edges that connects all vertices together, without any cycles, and with the minimum possible total edge weight.

## The Core Concept: Greedy Edge Selection

Kruskal's algorithm works by sorting all edges in the graph by weight and adding them one by one to the MST, provided they don't form a cycle.

**The Logic**:
1. Sort all edges in non-decreasing order of their weight.
2. Initialize a **Union-Find (DSU)** data structure to keep track of connected components.
3. For each sorted edge $(u, v)$ with weight $w$:
   - If $u$ and $v$ are not in the same component (checked via `find`):
     - Add the edge to the MST.
     - Perform a `union` of the components containing $u$ and $v$.
4. Stop when you have added $V-1$ edges (where $V$ is the number of vertices).

---

## Kruskal's Implementation in Java

This implementation relies on the `UnionFind` class we covered in previous guides.

```java
import java.util.*;

public class KruskalsAlgorithm {
    static class Edge implements Comparable<Edge> {
        int src, dest, weight;
        Edge(int s, int d, int w) { src = s; dest = d; weight = w; }
        
        @Override
        public int compareTo(Edge other) {
            return Integer.compare(this.weight, other.weight);
        }
    }

    public List<Edge> findMST(int n, List<Edge> edges) {
        List<Edge> mst = new ArrayList<>();
        
        // 1. Sort all edges
        Collections.sort(edges);

        // 2. Initialize Union-Find
        UnionFind uf = new UnionFind(n);

        // 3. Process edges greedily
        for (Edge edge : edges) {
            if (uf.find(edge.src) != uf.find(edge.dest)) {
                uf.union(edge.src, edge.dest);
                mst.add(edge);
            }
            
            // Optimization: Stop if we have V-1 edges
            if (mst.size() == n - 1) break;
        }

        return mst;
    }
}
```

---

## Why use Kruskal's vs. Prim's?

| Feature | Kruskal's | Prim's |
|---|---|---|
| **Approach** | Edge-based (Greedy) | Vertex-based (Greedy) |
| **Data Structure** | Union-Find + Sorting | Priority Queue (Min-Heap) |
| **Graph Density** | Better for **Sparse** graphs | Better for **Dense** graphs |
| **Complexity** | $O(E \log E)$ or $O(E \log V)$ | $O(E \log V)$ or $O(E + V \log V)$ |

## Real-World Applications

1. **Network Design**: Connecting cities with the minimum length of cables or roads.
2. **Cluster Analysis**: Finding patterns in data by connecting similar points.
3. **Approximation Algorithms**: Solving the Traveling Salesperson Problem (TSP) using MST as a lower bound.

## Summary

Kruskal's algorithm is elegantly simple. By focusing on the smallest edges first and using Union-Find to prevent cycles, it efficiently constructs the "cheapest" possible backbone for any graph. It is a perfect example of how combining two fundamental concepts (Sorting and DSU) leads to a powerful algorithmic solution.
