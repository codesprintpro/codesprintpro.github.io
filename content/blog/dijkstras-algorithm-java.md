---
title: "Dijkstra’s Algorithm in Java: Finding Shortest Paths in Weighted Graphs"
description: "Master Dijkstra's Algorithm in Java for finding the shortest paths from a single source to all other vertices in a weighted, non-negative edge graph. Learn its intuition, implementation with a PriorityQueue, dry runs, and complexity analysis."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "dijkstra", "shortest path", "weighted graph", "priority queue", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to Dijkstra’s Algorithm

**Dijkstra's Algorithm** is a classic and widely used algorithm for finding the **shortest paths** between nodes in a graph. Specifically, it finds the shortest path from a **single source node** to all other nodes in a **weighted graph** where all edge weights are **non-negative**. It's a greedy algorithm that works by iteratively expanding the set of visited nodes, always choosing the unvisited node with the smallest known distance from the source.

This algorithm is fundamental in network routing protocols, mapping applications (like Google Maps), and various other optimization problems where finding the most efficient route is critical.

## When Should You Think About Dijkstra’s Algorithm?

Consider using Dijkstra's Algorithm when:

*   You are given a **weighted graph**.
*   All **edge weights are non-negative**.
*   You need to find the **shortest path from a single source node to all other nodes**.
*   You need to find the shortest path from a single source node to a **single target node** (you can stop the algorithm once the target is reached).
*   Problems involve finding the minimum cost, minimum time, or minimum distance in a network.

## Core Concept of Dijkstra’s Algorithm

Dijkstra's Algorithm works by maintaining a set of visited nodes and a distance array (or map) that stores the shortest distance found so far from the source to each node. It uses a **priority queue** to efficiently select the next node to visit.

The steps are as follows:

1.  **Initialization**: 
    *   Create a `distance` array (or map) and initialize all distances to infinity, except for the source node, which is 0.
    *   Create a `priority queue` and add the source node with its distance (0).
    *   Create a `visited` set (or boolean array) to keep track of processed nodes.

2.  **Iteration**: While the priority queue is not empty:
    a.  Extract the node `u` with the smallest distance from the priority queue.
    b.  If `u` has already been visited, continue (this handles redundant entries in the priority queue).
    c.  Mark `u` as visited.
    d.  For each unvisited neighbor `v` of `u`:
        i.  Calculate the new distance to `v` through `u`: `newDist = distance[u] + weight(u, v)`.
        ii. If `newDist` is less than `distance[v]`, update `distance[v] = newDist` and add `(newDist, v)` to the priority queue.

3.  **Result**: The `distance` array will contain the shortest distances from the source to all reachable nodes.

## Example: Shortest Path in a Weighted Graph

Given a weighted, directed graph with `N` vertices and `M` edges, find the shortest distance from a given source vertex `S` to all other vertices.

#### Brute Force Approach (Conceptual)

A brute-force approach might involve trying all possible paths from the source to every other node and keeping track of the minimum. This would be computationally infeasible due to the exponential number of paths.

#### Optimized with Dijkstra’s Algorithm

```java
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.PriorityQueue;

class Edge {
    int target;
    int weight;

    public Edge(int target, int weight) {
        this.target = target;
        this.weight = weight;
    }
}

class Node implements Comparable<Node> {
    int vertex;
    int distance;

    public Node(int vertex, int distance) {
        this.vertex = vertex;
        this.distance = distance;
    }

    @Override
    public int compareTo(Node other) {
        return Integer.compare(this.distance, other.distance);
    }
}

class Solution {
    public int[] dijkstra(int numVertices, List<List<Edge>> adj, int source) {
        int[] dist = new int[numVertices];
        Arrays.fill(dist, Integer.MAX_VALUE); // Initialize distances to infinity
        boolean[] visited = new boolean[numVertices]; // Keep track of visited nodes

        PriorityQueue<Node> pq = new PriorityQueue<>();

        dist[source] = 0;
        pq.add(new Node(source, 0));

        while (!pq.isEmpty()) {
            Node current = pq.poll();
            int u = current.vertex;

            if (visited[u]) {
                continue; // Already processed this node with a shorter path
            }
            visited[u] = true;

            for (Edge edge : adj.get(u)) {
                int v = edge.target;
                int weight = edge.weight;

                // Relaxation step: if a shorter path to v is found through u
                if (!visited[v] && dist[u] != Integer.MAX_VALUE && dist[u] + weight < dist[v]) {
                    dist[v] = dist[u] + weight;
                    pq.add(new Node(v, dist[v]));
                }
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        int numVertices = 5;
        List<List<Edge>> adj = new ArrayList<>();
        for (int i = 0; i < numVertices; i++) {
            adj.add(new ArrayList<>());
        }

        // Example graph: (u, v, weight)
        adj.get(0).add(new Edge(1, 10));
        adj.get(0).add(new Edge(2, 3));
        adj.get(1).add(new Edge(2, 1));
        adj.get(1).add(new Edge(3, 2));
        adj.get(2).add(new Edge(1, 4));
        adj.get(2).add(new Edge(3, 8));
        adj.get(2).add(new Edge(4, 2));
        adj.get(3).add(new Edge(4, 5));

        Solution sol = new Solution();
        int[] shortestDistances = sol.dijkstra(numVertices, adj, 0);
        System.out.println("Shortest distances from source 0: " + Arrays.toString(shortestDistances)); // Expected: [0, 7, 3, 9, 5]
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(E log V)` using a binary heap (PriorityQueue), where `E` is the number of edges and `V` is the number of vertices. Each edge relaxation takes `O(log V)` due to priority queue operations.
*   **Space Complexity**: `O(V + E)` for the adjacency list, distance array, visited array, and priority queue.

### Dry Run: Dijkstra’s Algorithm

**Input:** Graph with 5 vertices, source = 0. Edges: (0,1,10), (0,2,3), (1,2,1), (1,3,2), (2,1,4), (2,3,8), (2,4,2), (3,4,5).

| Step | PQ (vertex, dist) | Extracted (u, dist) | `dist` array | `visited` array | Notes |
|------|-------------------|---------------------|--------------|-----------------|-------|
| Init | `[(0,0)]`         | -                   | `[0,∞,∞,∞,∞]` | `[F,F,F,F,F]`   | `dist[0]=0` |
| 1    | `[(2,3), (1,10)]` | `(0,0)`             | `[0,10,3,∞,∞]` | `[T,F,F,F,F]`   | Visit 0. Update `dist[2]=3`, `dist[1]=10`. Add to PQ. |
| 2    | `[(1,7), (1,10), (3,11), (4,5)]` | `(2,3)`             | `[0,7,3,11,5]` | `[T,F,T,F,F]`   | Visit 2. `dist[1]` updated to 7 (via 0->2->1). `dist[3]=11`, `dist[4]=5`. Add to PQ. |
| 3    | `[(4,5), (1,10), (3,9), (3,11)]` | `(4,5)`             | `[0,7,3,9,5]` | `[T,F,T,F,T]`   | Visit 4. No unvisited neighbors to update. (Note: `dist[3]` updated to 9 via 0->2->4->3, but 4 is visited here, so this path is not considered in this step. The PQ might have an older (3,11) entry. This is why `if (visited[u]) continue;` is important.) |
| 4    | `[(1,7), (1,10), (3,9), (3,11)]` | `(1,7)`             | `[0,7,3,9,5]` | `[T,T,T,F,T]`   | Visit 1. `dist[3]` updated to 9 (via 0->2->1->3). Add to PQ. |
| 5    | `[(3,9), (1,10), (3,11)]` | `(3,9)`             | `[0,7,3,9,5]` | `[T,T,T,T,T]`   | Visit 3. `dist[4]` (5) is already shorter than `dist[3]+weight(3,4)` (9+5=14). No update. |
| 6    | `[(1,10), (3,11)]` | `(1,10)`            | `[0,7,3,9,5]` | `[T,T,T,T,T]`   | `(1,10)` is a redundant entry in PQ (already visited 1 with dist 7). `continue`. |
| 7    | `[(3,11)]`         | `(3,11)`            | `[0,7,3,9,5]` | `[T,T,T,T,T]`   | `(3,11)` is a redundant entry in PQ (already visited 3 with dist 9). `continue`. |
| End  | `[]`              | -                   | `[0,7,3,9,5]` | `[T,T,T,T,T]`   | PQ empty. |

**Result:** `[0, 7, 3, 9, 5]`

## Reusable Template for Dijkstra’s Algorithm

```java
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.PriorityQueue;

class DijkstraTemplate {

    // Represents an edge in the graph
    static class Edge {
        int targetVertex;
        int weight;

        public Edge(int targetVertex, int weight) {
            this.targetVertex = targetVertex;
            this.weight = weight;
        }
    }

    // Represents a node in the priority queue
    static class DijkstraNode implements Comparable<DijkstraNode> {
        int vertex;
        int distance;

        public DijkstraNode(int vertex, int distance) {
            this.vertex = vertex;
            this.distance = distance;
        }

        @Override
        public int compareTo(DijkstraNode other) {
            return Integer.compare(this.distance, other.distance);
        }
    }

    /**
     * Finds the shortest paths from a single source vertex to all other vertices
     * in a weighted graph with non-negative edge weights.
     * @param numVertices The total number of vertices in the graph.
     * @param adj An adjacency list where adj.get(u) contains a list of Edge objects
     *            representing outgoing edges from vertex u.
     * @param source The starting vertex for finding shortest paths.
     * @return An array where result[i] is the shortest distance from source to vertex i.
     *         Integer.MAX_VALUE indicates an unreachable vertex.
     */
    public int[] findShortestPaths(int numVertices, List<List<Edge>> adj, int source) {
        int[] dist = new int[numVertices];
        Arrays.fill(dist, Integer.MAX_VALUE); // Initialize all distances to infinity
        boolean[] visited = new boolean[numVertices]; // To keep track of finalized nodes

        PriorityQueue<DijkstraNode> pq = new PriorityQueue<>();

        dist[source] = 0;
        pq.add(new DijkstraNode(source, 0));

        while (!pq.isEmpty()) {
            DijkstraNode current = pq.poll();
            int u = current.vertex;

            // If we've already found a shorter path to u and processed it, skip
            if (visited[u]) {
                continue;
            }
            visited[u] = true;

            // Iterate over all neighbors of u
            for (Edge edge : adj.get(u)) {
                int v = edge.targetVertex;
                int weight = edge.weight;

                // Only relax if v is not yet visited and a shorter path is found
                if (!visited[v] && dist[u] != Integer.MAX_VALUE && dist[u] + weight < dist[v]) {
                    dist[v] = dist[u] + weight;
                    pq.add(new DijkstraNode(v, dist[v]));
                }
            }
        }
        return dist;
    }
}
```

## How to Recognize Dijkstra’s Algorithm in Interviews

Look for these clues:

*   **Data Structure**: Graph (usually represented by an adjacency list or matrix).
*   **Goal**: Find the **shortest path**.
*   **Edge Weights**: Explicitly stated that **edge weights are non-negative**.
*   **Scope**: From a **single source** to all other nodes, or to a specific target node.
*   **Keywords**: "Shortest path", "minimum cost", "minimum time", "minimum distance", "network routing", "weighted graph".

## Common Mistakes

### Mistake 1: Using Dijkstra’s with Negative Edge Weights

Dijkstra's Algorithm does not work correctly with negative edge weights because its greedy approach assumes that once a node's distance is finalized, it won't be improved. Negative cycles would lead to infinite loops, and even negative edges can lead to incorrect shortest paths. For graphs with negative edge weights, use Bellman-Ford or SPFA.

### Mistake 2: Not Using a Priority Queue (or inefficient implementation)

Without a priority queue, selecting the minimum distance node in each step would take `O(V)` time, leading to an overall `O(V^2 + E)` complexity. A binary heap (Java's `PriorityQueue`) optimizes this to `O(E log V)`.

### Mistake 3: Not Handling Visited Nodes Correctly

It's crucial to mark nodes as visited *after* extracting them from the priority queue and *before* processing their neighbors. This prevents redundant processing and ensures the shortest path to that node has been finalized.

### Mistake 4: Integer Overflow

When calculating `dist[u] + weight`, ensure that `dist[u]` is not `Integer.MAX_VALUE` before adding `weight`, as this could lead to overflow. Also, be mindful of `Integer.MAX_VALUE` itself, as adding to it will wrap around to a negative number.

## Dijkstra’s vs. Other Shortest Path Algorithms

| Algorithm         | Graph Type             | Edge Weights     | Single Source/All Pairs | Time Complexity      | Space Complexity |
|-------------------|------------------------|------------------|-------------------------|----------------------|------------------|
| **BFS**           | Unweighted             | N/A              | Single Source           | `O(V + E)`           | `O(V + E)`       |
| **Dijkstra’s**    | Weighted, No Negative Edges | Non-negative     | Single Source           | `O(E log V)` (PQ)    | `O(V + E)`       |
| **Bellman-Ford**  | Weighted, Negative Edges | Can be negative  | Single Source           | `O(V * E)`           | `O(V)`           |
| **Floyd-Warshall**| Weighted, No Negative Cycles | Can be negative  | All Pairs               | `O(V^3)`             | `O(V^2)`         |

## Practice Problems for This Pattern

1.  **Dijkstra's Algorithm** (e.g., various competitive programming platforms) - Direct implementation.
2.  **Network Delay Time** (LeetCode 743) - Find the time it takes for all nodes to receive a signal.
3.  **Path With Maximum Probability** (LeetCode 1514) - A variation where you maximize probability instead of minimizing distance (can be adapted from Dijkstra's).
4.  **Cheapest Flights Within K Stops** (LeetCode 787) - Can be solved with a modified Dijkstra's or Bellman-Ford.

## Interview Script You Can Reuse

```text
"This problem asks for the shortest path in a weighted graph with non-negative edge weights, which is a classic application for Dijkstra's Algorithm. I'll use a `PriorityQueue` to efficiently extract the node with the minimum distance. I'll initialize a `distance` array with infinity for all nodes except the source, which will be 0. I'll add the source to the priority queue. In a loop, I'll extract the node `u` with the smallest distance from the PQ. If `u` has already been visited, I'll skip it. Otherwise, I'll mark `u` as visited and iterate through its neighbors `v`. For each neighbor, I'll perform a relaxation step: if `dist[u] + weight(u,v)` is less than `dist[v]`, I'll update `dist[v]` and add `(v, dist[v])` to the priority queue. This approach guarantees an O(E log V) time complexity and O(V + E) space complexity."
```

## Final Takeaways

*   **Dijkstra's Algorithm** finds **shortest paths from a single source**.
*   Works on **weighted graphs** with **non-negative edge weights**.
*   Uses a **PriorityQueue** for efficient selection of the next node.
*   Achieves **`O(E log V)` time complexity** and **`O(V + E)` space complexity**.
*   Fundamental for **network routing** and **optimization problems**.

Mastering Dijkstra's Algorithm is crucial for solving a wide range of shortest path problems in real-world applications.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
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
