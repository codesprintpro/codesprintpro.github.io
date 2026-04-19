---
title: "Union Find (Disjoint Set Union) in Java: Solving Connectivity Problems"
description: "Master the Union Find (DSU) data structure in Java. Learn how to implement path compression and union by rank to solve dynamic connectivity and cycle detection problems in near-constant time."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "graph", "union find", "dsu", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

The **Union Find** data structure, also known as **Disjoint Set Union (DSU)**, is a powerful tool for tracking elements partitioned into a number of disjoint (non-overlapping) sets.

It is specifically designed to answer two types of queries extremely fast:
1. **Find**: Which set does this element belong to?
2. **Union**: Join two sets into one.

## When to use Union Find?
- Dynamic connectivity (are these two nodes connected?)
- Cycle detection in an undirected graph
- Kruskal's algorithm for Minimum Spanning Tree
- Number of connected components

---

## The Optimized Implementation

A basic Union Find can be slow ($O(N)$), but with two simple optimizations, it becomes nearly $O(1)$ on average:
1. **Path Compression**: Flatten the tree structure during `find` operations.
2. **Union by Rank/Size**: Always attach the smaller tree under the larger tree to keep it balanced.

```java
public class UnionFind {
    private int[] parent;
    private int[] rank;
    private int count; // Number of disjoint sets

    public UnionFind(int n) {
        parent = new int[n];
        rank = new int[n];
        count = n;
        for (int i = 0; i < n; i++) {
            parent[i] = i; // Each node is its own parent initially
            rank[i] = 1;
        }
    }

    // Find with Path Compression
    public int find(int i) {
        if (parent[i] == i) return i;
        return parent[i] = find(parent[i]); // Path compression
    }

    // Union by Rank
    public void union(int i, int j) {
        int rootI = find(i);
        int rootJ = find(j);
        
        if (rootI != rootJ) {
            if (rank[rootI] < rank[rootJ]) {
                parent[rootI] = rootJ;
            } else if (rank[rootI] > rank[rootJ]) {
                parent[rootJ] = rootI;
            } else {
                parent[rootI] = rootJ;
                rank[rootJ]++;
            }
            count--; // Merged two sets
        }
    }

    public int getCount() {
        return count;
    }
}
```

---

## Example: Number of Connected Components

Given $N$ nodes and a list of edges, find how many separate "islands" of nodes exist.

```java
public int countComponents(int n, int[][] edges) {
    UnionFind uf = new UnionFind(n);
    for (int[] edge : edges) {
        uf.union(edge[0], edge[1]);
    }
    return uf.getCount();
}
```

## Complexity Analysis

With both **Path Compression** and **Union by Rank**, the time complexity per operation is $O(\alpha(N))$, where $\alpha$ is the inverse Ackermann function. For all practical values of $N$, this is effectively **constant time** $O(1)$.

| Optimization | Benefit |
|---|---|
| **No Optimization** | $O(N)$ depth trees |
| **Path Compression** | Flattens the tree during each `find` |
| **Union by Rank** | Prevents deep trees by merging smaller into larger |

## Summary

Union Find is the go-to algorithm for connectivity. While BFS or DFS can also find connected components in $O(V+E)$, Union Find excels in **dynamic** scenarios where edges are being added one by one and you need to check connectivity after each addition.
