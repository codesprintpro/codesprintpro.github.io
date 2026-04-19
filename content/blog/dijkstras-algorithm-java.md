---
title: "Dijkstra's Algorithm in Java: Finding the Shortest Path"
description: "Master Dijkstra's shortest path algorithm in Java. Learn the greedy logic, how to use PriorityQueue for efficiency, and how to solve common weighted graph interview problems."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "graph", "shortest path", "dijkstra", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

Dijkstra's algorithm is the industry standard for finding the shortest path from a starting node to all other nodes in a graph with **non-negative** edge weights.

Whether you are building a navigation system like Google Maps or optimizing network packet routing, Dijkstra is the core engine.

## The Core Concept: Greedy Exploration

Dijkstra's algorithm is **greedy**. It always picks the "closest" unvisited node and relaxes its neighbors (updates their shortest known distance).

**The Logic**:
1. Initialize a `distances` array with infinity, except for the source node which is 0.
2. Use a **Min-Heap (PriorityQueue)** to store nodes as `(distance, nodeId)` pairs.
3. While the heap is not empty:
   - Pop the node with the smallest distance.
   - For each neighbor, calculate `newDist = currentDist + weight(current, neighbor)`.
   - If `newDist` is smaller than the current known distance to the neighbor, update it and push the neighbor to the heap.

---

## Dijkstra Implementation in Java

```java
import java.util.*;

public class Dijkstra {
    static class Edge {
        int target, weight;
        Edge(int t, int w) { target = t; weight = w; }
    }

    static class Node implements Comparable<Node> {
        int id, distance;
        Node(int i, int d) { id = i; distance = d; }
        
        @Override
        public int compareTo(Node other) {
            return Integer.compare(this.distance, other.distance);
        }
    }

    public int[] shortestPath(int n, List<List<Edge>> adj, int startNode) {
        int[] dist = new int[n];
        Arrays.fill(dist, Integer.MAX_VALUE);
        dist[startNode] = 0;

        PriorityQueue<Node> pq = new PriorityQueue<>();
        pq.add(new Node(startNode, 0));

        while (!pq.isEmpty()) {
            Node current = pq.poll();
            int u = current.id;

            // Important: If we found a better path already, skip this stale node
            if (current.distance > dist[u]) continue;

            for (Edge edge : adj.get(u)) {
                int v = edge.target;
                int weight = edge.weight;

                if (dist[u] + weight < dist[v]) {
                    dist[v] = dist[u] + weight;
                    pq.add(new Node(v, dist[v]));
                }
            }
        }
        return dist;
    }
}
```

---

## When to use Dijkstra?

| Feature | Dijkstra | BFS |
|---|---|---|
| **Graph Type** | Weighted | Unweighted |
| **Edge Weights** | Must be non-negative | No weights (or all weights equal) |
| **Complexity** | $O(E \log V)$ | $O(V + E)$ |
| **Goal** | Shortest path by weight | Shortest path by number of hops |

## Common Interview Pitfalls

1. **Negative Weights**: Dijkstra does **not** work with negative edge weights. You need the Bellman-Ford algorithm for that.
2. **Cycle Handling**: Dijkstra naturally handles cycles in positive weighted graphs, but you should always include the `if (current.distance > dist[u]) continue;` check to avoid re-processing stale entries in the PriorityQueue.
3. **Memory**: If the graph is very dense, $E$ can be up to $V^2$, making the priority queue operations more expensive.

## Summary

Dijkstra's algorithm is a masterclass in greedy optimization. By always focusing on the most promising (closest) node first, it guarantees the shortest path to every node in a single pass of exploration. Mastering this algorithm demonstrates a deep understanding of both graph theory and the efficient use of the Heap data structure.
