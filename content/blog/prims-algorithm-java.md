---
title: "Prim's Algorithm in Java: Minimum Spanning Tree via Greedy Growth"
description: "Master Prim's algorithm in Java. Learn how to use a PriorityQueue to build a Minimum Spanning Tree (MST) by growing it one vertex at a time from a starting node."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "graph", "mst", "prim", "priority queue", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

While Kruskal's algorithm focuses on edges, **Prim's algorithm** takes a vertex-centric approach to finding the **Minimum Spanning Tree (MST)**.

It starts from an arbitrary node and "grows" the tree by always adding the cheapest edge that connects a vertex in the tree to a vertex outside the tree.

## The Core Concept: Greedy Growth

Prim's algorithm is very similar to Dijkstra's. The main difference is that while Dijkstra minimizes the *total distance* from the source, Prim minimizes the *edge weight* required to connect a new node to the existing tree.

**The Logic**:
1. Start with an arbitrary vertex and mark it as visited.
2. Use a **Min-Heap (PriorityQueue)** to store all edges connecting the visited vertices to unvisited ones.
3. While the heap is not empty:
   - Pop the edge with the smallest weight.
   - If the target vertex is already visited, skip it.
   - Otherwise, mark it as visited and add the edge to the MST.
   - Add all edges from this new vertex to its unvisited neighbors into the heap.

---

## Prim's Implementation in Java

```java
import java.util.*;

public class PrimsAlgorithm {
    static class Edge {
        int target, weight;
        Edge(int t, int w) { target = t; weight = w; }
    }

    static class Node implements Comparable<Node> {
        int id, weight;
        Node(int i, int w) { id = i; weight = w; }
        
        @Override
        public int compareTo(Node other) {
            return Integer.compare(this.weight, other.weight);
        }
    }

    public List<int[]> findMST(int n, List<List<Edge>> adj) {
        List<int[]> mst = new ArrayList<>();
        boolean[] visited = new boolean[n];
        PriorityQueue<Node> pq = new PriorityQueue<>();

        // Start from node 0 (arbitrary)
        pq.add(new Node(0, 0));
        int[] parent = new int[n];
        int[] key = new int[n];
        Arrays.fill(key, Integer.MAX_VALUE);
        Arrays.fill(parent, -1);
        key[0] = 0;

        while (!pq.isEmpty()) {
            Node current = pq.poll();
            int u = current.id;

            if (visited[u]) continue;
            visited[u] = true;

            // If it's not the start node, add the edge to MST
            if (parent[u] != -1) {
                mst.add(new int[]{parent[u], u, key[u]});
            }

            for (Edge edge : adj.get(u)) {
                int v = edge.target;
                int weight = edge.weight;

                if (!visited[v] && weight < key[v]) {
                    key[v] = weight;
                    parent[v] = u;
                    pq.add(new Node(v, key[v]));
                }
            }
        }
        return mst;
    }
}
```

---

## Kruskal's vs. Prim's: Which to use?

| Scenario | Recommendation |
|---|---|
| **Sparse Graph** (fewer edges) | **Kruskal's** is usually faster because it sorts edges once. |
| **Dense Graph** (many edges) | **Prim's** performs better, especially with an adjacency list and binary heap. |
| **Disconnected Graph** | Kruskal's naturally finds a Minimum Spanning *Forest*. Prim's only finds the MST for one component. |

## Common Pitfalls

1. **Self-loops and Multiple Edges**: Prim's handles these naturally by always picking the minimum weight, but ensure your adjacency list logic is clean.
2. **Disconnected Components**: If the graph is not connected, `visited` will remain `false` for some nodes. You may need to run the algorithm multiple times to cover all components.

## Summary

Prim's algorithm is a greedy powerhouse. By iteratively expanding the "safe" frontier of your tree with the cheapest possible connection, it ensures that you reach every node with the absolute minimum resource expenditure. Its similarity to Dijkstra makes it a high-value algorithm to learn for any backend or systems-level engineering role.
