---
title: "Bellman-Ford Algorithm in Java: Shortest Paths with Negative Weights"
description: "Master Bellman-Ford Algorithm in Java for finding shortest paths in weighted graphs, including those with negative edge weights. Learn its intuition, implementation, dry runs, and how to detect negative cycles."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "bellman-ford", "shortest path", "weighted graph", "negative weights", "negative cycle", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to Bellman-Ford Algorithm

**Bellman-Ford Algorithm** is a single-source shortest path algorithm that works on **weighted graphs**, including those with **negative edge weights**. Unlike Dijkstra's algorithm, which fails with negative weights, Bellman-Ford can correctly find the shortest paths in such graphs. Furthermore, it has the crucial ability to **detect negative cycles**, which are cycles where the sum of edge weights is negative, indicating that shortest paths are undefined (can be infinitely small).

This algorithm is fundamental for understanding shortest path problems in more complex scenarios, especially in network routing protocols where link costs can sometimes be negative.

## When Should You Think About Bellman-Ford Algorithm?

Consider using Bellman-Ford Algorithm when:

*   You are given a **weighted graph**.
*   The graph might contain **negative edge weights**.
*   You need to find the **shortest path from a single source node to all other nodes**.
*   You need to **detect the presence of negative cycles** in the graph.

## Core Concept of Bellman-Ford Algorithm

Bellman-Ford works on the principle of **relaxation**. It iteratively relaxes all edges `V-1` times, where `V` is the number of vertices. In each iteration, it tries to find a shorter path to all vertices through their neighbors. After `V-1` iterations, if there are no negative cycles, the shortest paths are guaranteed to have been found.

The steps are as follows:

1.  **Initialization**: 
    *   Create a `distance` array (or map) and initialize all distances to infinity, except for the source node, which is 0.

2.  **Relaxation (V-1 times)**: Repeat `V-1` times:
    a.  For each edge `(u, v)` with weight `w` in the graph:
        i.  If `distance[u]` is not infinity and `distance[u] + w < distance[v]`:
            *   Update `distance[v] = distance[u] + w`.

3.  **Negative Cycle Detection**: After `V-1` iterations, perform one more iteration over all edges:
    a.  For each edge `(u, v)` with weight `w`:
        i.  If `distance[u]` is not infinity and `distance[u] + w < distance[v]`:
            *   A negative cycle is detected. The shortest paths are undefined.

4.  **Result**: If no negative cycle is detected, the `distance` array contains the shortest distances from the source to all reachable nodes.

## Example: Shortest Path with Negative Weights

Given a weighted, directed graph with `N` vertices and `M` edges, where edge weights can be negative, find the shortest distance from a given source vertex `S` to all other vertices. Also, detect if a negative cycle exists.

#### Brute Force Approach (Conceptual)

Trying all possible paths would be computationally infeasible due to the exponential number of paths, especially with negative weights where paths can become arbitrarily short if a negative cycle is present.

#### Optimized with Bellman-Ford Algorithm

```java
import java.util.Arrays;

class Edge {
    int source, destination, weight;

    public Edge(int source, int destination, int weight) {
        this.source = source;
        this.destination = destination;
        this.weight = weight;
    }
}

class Solution {
    public int[] bellmanFord(int numVertices, List<Edge> edges, int source) {
        int[] dist = new int[numVertices];
        Arrays.fill(dist, Integer.MAX_VALUE); // Initialize distances to infinity
        dist[source] = 0;

        // Relax all edges V-1 times
        for (int i = 0; i < numVertices - 1; i++) {
            for (Edge edge : edges) {
                int u = edge.source;
                int v = edge.destination;
                int weight = edge.weight;

                if (dist[u] != Integer.MAX_VALUE && dist[u] + weight < dist[v]) {
                    dist[v] = dist[u] + weight;
                }
            }
        }

        // Check for negative cycles
        for (Edge edge : edges) {
            int u = edge.source;
            int v = edge.destination;
            int weight = edge.weight;

            if (dist[u] != Integer.MAX_VALUE && dist[u] + weight < dist[v]) {
                // Negative cycle detected
                System.out.println("Graph contains negative cycle!");
                return new int[0]; // Or throw an exception, or return a special value
            }
        }

        return dist;
    }

    public static void main(String[] args) {
        int numVertices = 5;
        List<Edge> edges = new ArrayList<>();
        edges.add(new Edge(0, 1, -1));
        edges.add(new Edge(0, 2, 4));
        edges.add(new Edge(1, 2, 3));
        edges.add(new Edge(1, 3, 2));
        edges.add(new Edge(1, 4, 2));
        edges.add(new Edge(3, 2, 5));
        edges.add(new Edge(3, 1, 1));
        edges.add(new Edge(4, 3, -3));

        Solution sol = new Solution();
        int[] shortestDistances = sol.bellmanFord(numVertices, edges, 0);

        if (shortestDistances.length > 0) {
            System.out.println("Shortest distances from source 0: " + Arrays.toString(shortestDistances));
            // Expected: [0, -1, 2, -2, 1]
        }

        // Example with negative cycle
        List<Edge> edgesWithCycle = new ArrayList<>();
        edgesWithCycle.add(new Edge(0, 1, 1));
        edgesWithCycle.add(new Edge(1, 2, -1));
        edgesWithCycle.add(new Edge(2, 0, -1)); // Negative cycle: 0 -> 1 -> 2 -> 0 (sum = 1 - 1 - 1 = -1)

        System.out.println("\nTesting with negative cycle:");
        sol.bellmanFord(3, edgesWithCycle, 0);
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(V * E)`, where `V` is the number of vertices and `E` is the number of edges. This is because the relaxation step is performed `V-1` times, and in each step, all `E` edges are processed.
*   **Space Complexity**: `O(V)` for the `dist` array and `O(E)` for storing the edges.

### Dry Run: Bellman-Ford Algorithm

**Input:** `numVertices = 5`, `source = 0`
Edges: (0,1,-1), (0,2,4), (1,2,3), (1,3,2), (1,4,2), (3,2,5), (3,1,1), (4,3,-3)

**Initial `dist` array:** `[0, ∞, ∞, ∞, ∞]`

**Iteration 1 (k=0):**
| Edge (u,v,w) | `dist[u]` | `dist[v]` (before) | `dist[u]+w` | `dist[v]` (after) | Notes |
|--------------|-----------|--------------------|-------------|--------------------|-------|
| (0,1,-1)     | 0         | ∞                  | -1          | -1                 | `dist[1]` updated |
| (0,2,4)      | 0         | ∞                  | 4           | 4                  | `dist[2]` updated |
| (1,2,3)      | -1        | 4                  | 2           | 2                  | `dist[2]` updated |
| (1,3,2)      | -1        | ∞                  | 1           | 1                  | `dist[3]` updated |
| (1,4,2)      | -1        | ∞                  | 1           | 1                  | `dist[4]` updated |
| (3,2,5)      | 1         | 2                  | 6           | 2                  | No update (6 > 2) |
| (3,1,1)      | 1         | -1                 | 2           | -1                 | No update (2 > -1) |
| (4,3,-3)     | 1         | 1                  | -2          | -2                 | `dist[3]` updated |

**`dist` after Iteration 1:** `[0, -1, 2, -2, 1]`

**Iteration 2 (k=1):**
| Edge (u,v,w) | `dist[u]` | `dist[v]` (before) | `dist[u]+w` | `dist[v]` (after) | Notes |
|--------------|-----------|--------------------|-------------|--------------------|-------|
| (0,1,-1)     | 0         | -1                 | -1          | -1                 | No update |
| (0,2,4)      | 0         | 2                  | 4           | 2                  | No update |
| (1,2,3)      | -1        | 2                  | 2           | 2                  | No update |
| (1,3,2)      | -1        | -2                 | 1           | -2                 | No update |
| (1,4,2)      | -1        | 1                  | 1           | 1                  | No update |
| (3,2,5)      | -2        | 2                  | 3           | 2                  | No update |
| (3,1,1)      | -2        | -1                 | -1          | -1                 | No update |
| (4,3,-3)     | 1         | -2                 | -2          | -2                 | No update |

**`dist` after Iteration 2:** `[0, -1, 2, -2, 1]` (No changes, indicating shortest paths are likely found)

(Further iterations 3 and 4 would also yield no changes for this graph.)

**Negative Cycle Check (Iteration V):**
Iterate through all edges one last time. If any `dist[u] + w < dist[v]` holds, a negative cycle exists.
In this example, no such condition will be met, so no negative cycle is detected.

**Final Result:** `[0, -1, 2, -2, 1]`

## Reusable Template for Bellman-Ford Algorithm

```java
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

class BellmanFordAlgorithm {

    static class Edge {
        int source, destination, weight;

        public Edge(int source, int destination, int weight) {
            this.source = source;
            this.destination = destination;
            this.weight = weight;
        }
    }

    /**
     * Finds the shortest paths from a single source vertex to all other vertices
     * in a weighted graph, including those with negative edge weights.
     * Also detects negative cycles.
     * @param numVertices The total number of vertices in the graph.
     * @param edges A list of all edges in the graph.
     * @param source The starting vertex for finding shortest paths.
     * @return An array where result[i] is the shortest distance from source to vertex i.
     *         Integer.MAX_VALUE indicates an unreachable vertex. Returns an empty array
     *         if a negative cycle is detected.
     */
    public int[] findShortestPaths(int numVertices, List<Edge> edges, int source) {
        int[] dist = new int[numVertices];
        Arrays.fill(dist, Integer.MAX_VALUE); // Initialize all distances to infinity
        dist[source] = 0;

        // Relax all edges V-1 times
        // After V-1 iterations, shortest paths are guaranteed if no negative cycles
        for (int i = 0; i < numVertices - 1; i++) {
            // Flag to optimize: if no distance was updated in an iteration, we can stop early
            boolean updatedInThisIteration = false;
            for (Edge edge : edges) {
                int u = edge.source;
                int v = edge.destination;
                int weight = edge.weight;

                // Check for Integer.MAX_VALUE to prevent overflow and ensure reachability
                if (dist[u] != Integer.MAX_VALUE && dist[u] + weight < dist[v]) {
                    dist[v] = dist[u] + weight;
                    updatedInThisIteration = true;
                }
            }
            // If no distances were updated in this iteration, we can stop early
            if (!updatedInThisIteration) {
                break;
            }
        }

        // Check for negative cycles (one more relaxation pass)
        // If a distance can still be reduced, a negative cycle exists
        for (Edge edge : edges) {
            int u = edge.source;
            int v = edge.destination;
            int weight = edge.weight;

            if (dist[u] != Integer.MAX_VALUE && dist[u] + weight < dist[v]) {
                // Negative cycle detected
                return new int[0]; // Indicate negative cycle
            }
        }

        return dist;
    }
}
```

## How to Recognize Bellman-Ford Algorithm in Interviews

Look for these clues:

*   **Data Structure**: Weighted, directed graph.
*   **Edge Weights**: Explicitly stated that **negative edge weights are possible**.
*   **Goal**: Find the **shortest path from a single source node to all other nodes**.
*   **Requirement**: Need to **detect negative cycles**.
*   **Keywords**: "Shortest path with negative weights", "negative cycle detection", "arbitrage opportunities" (in financial graphs).

## Common Mistakes

### Mistake 1: Not Handling `Integer.MAX_VALUE` Correctly

When `dist[u]` is `Integer.MAX_VALUE`, `dist[u] + weight` can overflow and become a negative number, leading to incorrect updates. Always check `dist[u] != Integer.MAX_VALUE` before performing the sum.

### Mistake 2: Incorrect Number of Iterations

The relaxation loop must run exactly `V-1` times to guarantee shortest paths (if no negative cycles). Running fewer times might not find all shortest paths. The `V`-th iteration is solely for negative cycle detection.

### Mistake 3: Forgetting Negative Cycle Detection

One of Bellman-Ford's key features is negative cycle detection. Failing to perform the `V`-th iteration to check for further relaxations means you miss this crucial information.

### Mistake 4: Applying to Undirected Graphs with Negative Edges

For undirected graphs, a negative edge `(u, v)` with weight `w` implies two directed edges `u -> v` with weight `w` and `v -> u` with weight `w`. If `w` is negative, this immediately forms a negative cycle `u -> v -> u`. Bellman-Ford can still be applied, but you must be aware that any negative edge in an undirected graph implies a negative cycle.

## Bellman-Ford vs. Other Shortest Path Algorithms

| Algorithm         | Graph Type             | Edge Weights     | Single Source/All Pairs | Time Complexity      | Space Complexity |
|-------------------|------------------------|------------------|-------------------------|----------------------|------------------|
| **BFS**           | Unweighted             | N/A              | Single Source           | `O(V + E)`           | `O(V + E)`       |
| **Dijkstra’s**    | Weighted, No Negative Edges | Non-negative     | Single Source           | `O(E log V)` (PQ)    | `O(V + E)`       |
| **Bellman-Ford**  | Weighted, Negative Edges | Can be negative  | Single Source           | `O(V * E)`           | `O(V + E)`       |
| **Floyd-Warshall**| Weighted, No Negative Cycles | Can be negative  | All Pairs               | `O(V^3)`             | `O(V^2)`         |

## Practice Problems for This Pattern

1.  **Bellman-Ford Algorithm** (e.g., various competitive programming platforms) - Direct implementation.
2.  **Cheapest Flights Within K Stops** (LeetCode 787) - Can be solved with a modified Bellman-Ford (or BFS).
3.  **Find the City With the Smallest Number of Neighbors at a Threshold Distance** (LeetCode 1334) - Can use Bellman-Ford for all-pairs shortest paths if `V` is small.

## Interview Script You Can Reuse

```text
"This problem involves finding shortest paths in a weighted graph that might contain negative edge weights, and potentially detecting negative cycles. This immediately points to the Bellman-Ford algorithm. I'll initialize a `distance` array with infinity for all nodes except the source, which will be 0. Then, I'll iterate `V-1` times, and in each iteration, I'll relax all edges. The relaxation step involves checking if `dist[u] + weight(u,v)` is less than `dist[v]`, and if so, updating `dist[v]`. After `V-1` iterations, if no negative cycles exist, the shortest paths are found. To detect negative cycles, I'll perform one more iteration over all edges; if any distance can still be reduced, a negative cycle is present. This approach yields an O(V * E) time complexity and O(V + E) space complexity."
```

## Final Takeaways

*   **Bellman-Ford Algorithm** finds **shortest paths from a single source**.
*   Works on **weighted graphs** with **negative edge weights**.
*   Crucially, it can **detect negative cycles**.
*   Achieves **`O(V * E)` time complexity** and **`O(V + E)` space complexity**.
*   Essential for problems where negative edge weights or negative cycle detection are concerns.

Mastering Bellman-Ford is vital for handling shortest path problems in complex graphs where edge weights can be negative, providing a robust solution and critical cycle detection capabilities.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
*   [Kruskal’s Algorithm in Java](/blog/kruskals-algorithm-java/)
*   [Prim’s Algorithm in Java](/blog/prims-algorithm-java/)
*   [Matrix Traversal in Java](/blog/matrix-traversal-java/)
*   [Dijkstra’s Algorithm in Java](/blog/dijkstras-algorithm-java/)
*   [Union Find (DSU) in Java](/blog/union-find-dsu-java/)
*   [Topological Sort in Java](/blog/topological-sort-kahns-algorithm-java/)
*   [BFS (Breadth First Search) in Java](/blog/bfs-tree-graph-traversals-java/)
*   [DFS (Depth First Search) in Java](/blog/dfs-tree-graph-traversals-java/)
*   [Monotonic Queue Pattern in Java](/blog/monotonic-queue-pattern-java/)
*   [Monotonic Stack Pattern in Java](/blog/monotonic-stack-pattern-java/)
*   [Sorting Algorithms in Java](/blog/sorting-algorithms-java/)
*   [Binary Search Pattern in Java](/blog/binary-search-pattern-java/)
*   [In-place Reversal of a Linked List in Java](/blog/in-place-linked-list-reversal-java/)
*   [Fast & Slow Pointers in Java](/blog/fast-slow-pointers-java/)
*   [Dutch National Flag Pattern in Java](/blog/dutch-national-flag-pattern-java/)
*   [Kadane’s Algorithm in Java](/blog/kadanes-algorithm-java/)
*   [Prefix Sum Pattern in Java](/blog/prefix-sum-pattern-java/)
*   [Sliding Window Pattern in Java](/blog/sliding-window-pattern-java/)
*   [Two Pointers Pattern in Java](/blog/two-pointers-pattern-java/)
*   [Big-O Notation in Java](/blog/big-o-notation-java-interview-problem-solving/)
