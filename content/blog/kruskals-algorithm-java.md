---
title: "Kruskal’s Algorithm in Java: Minimum Spanning Trees (MST)"
description: "Master Kruskal's Algorithm in Java for finding the Minimum Spanning Tree (MST) of a connected, undirected, weighted graph. Learn its intuition, implementation with Union-Find, dry runs, and complexity analysis."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "kruskal's algorithm", "mst", "minimum spanning tree", "graph", "union find", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to Kruskal’s Algorithm

**Kruskal's Algorithm** is another greedy algorithm used to find a **Minimum Spanning Tree (MST)** for a connected, undirected, weighted graph. Similar to Prim's, an MST connects all vertices with the minimum possible total edge weight without forming any cycles. However, Kruskal's takes a different approach: instead of growing a single tree, it grows a forest of trees, merging them until all vertices are connected.

Kruskal's algorithm is particularly intuitive because it simply sorts all edges by weight and then adds them one by one if they don't form a cycle. This makes it well-suited for sparse graphs (graphs with relatively few edges).

## When Should You Think About Kruskal’s Algorithm?

Consider using Kruskal's Algorithm when:

*   You are given a **connected, undirected, weighted graph**.
*   You need to find a **Minimum Spanning Tree (MST)**.
*   The problem involves connecting all components with the **minimum total cost/weight**.
*   The graph is **sparse** (number of edges `E` is much smaller than `V^2`).
*   Problems related to network design, cluster analysis, or laying out connections.

## Core Concept of Kruskal’s Algorithm

Kruskal's Algorithm relies heavily on the **Union-Find (Disjoint Set Union)** data structure to efficiently detect cycles. The steps are as follows:

1.  **Sort Edges**: Create a list of all edges in the graph and sort them in non-decreasing order of their weights.
2.  **Initialize Disjoint Sets**: Create `V` disjoint sets, one for each vertex. This is where Union-Find comes in: each vertex is initially in its own set.
3.  **Iterate Through Sorted Edges**: Iterate through the sorted edges. For each edge `(u, v)` with weight `w`:
    a.  Check if `u` and `v` are already in the same set using the `find` operation of Union-Find.
    b.  If `u` and `v` are in different sets (i.e., adding this edge will not form a cycle):
        i.  Add the edge `(u, v)` to the MST.
        ii. Merge the sets containing `u` and `v` using the `union` operation of Union-Find.
        iii. Add `w` to the total MST cost.
4.  **Termination**: Continue until `V-1` edges have been added to the MST (which means all vertices are connected), or all edges have been processed.

## Example: Connecting Islands with Minimum Cost

Given `n` islands and a list of `bridges` where `bridges[i] = [island1, island2, cost]` represents the cost to build a bridge between `island1` and `island2`. Find the minimum cost to connect all islands. If it's impossible to connect all islands, return -1.

#### Brute Force Approach (Conceptual)

Similar to Prim's, a brute-force approach would involve generating all possible spanning trees and finding the one with the minimum total weight, which is computationally infeasible.

#### Optimized with Kruskal’s Algorithm

```java
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

// UnionFind class (as seen in Union Find DSU article)
class UnionFind {
    private int[] parent;
    private int[] size;
    private int count; // Number of disjoint sets

    public UnionFind(int n) {
        parent = new int[n];
        size = new int[n];
        count = n;
        for (int i = 0; i < n; i++) {
            parent[i] = i;
            size[i] = 1;
        }
    }

    public int find(int i) {
        if (parent[i] == i) {
            return i;
        }
        return parent[i] = find(parent[i]);
    }

    public void union(int i, int j) {
        int rootI = find(i);
        int rootJ = find(j);

        if (rootI != rootJ) {
            if (size[rootI] < size[rootJ]) {
                parent[rootI] = rootJ;
                size[rootJ] += size[rootI];
            } else {
                parent[rootJ] = rootI;
                size[rootI] += size[rootJ];
            }
            count--;
        }
    }

    public int getCount() {
        return count;
    }
}

class KruskalEdge implements Comparable<KruskalEdge> {
    int u, v, weight;

    public KruskalEdge(int u, int v, int weight) {
        this.u = u;
        this.v = v;
        this.weight = weight;
    }

    @Override
    public int compareTo(KruskalEdge other) {
        return Integer.compare(this.weight, other.weight);
    }
}

class Solution {
    public int minCostConnectIslands(int n, int[][] bridges) {
        List<KruskalEdge> edges = new ArrayList<>();
        for (int[] bridge : bridges) {
            // Adjust to 0-indexed nodes if necessary
            edges.add(new KruskalEdge(bridge[0], bridge[1], bridge[2]));
        }

        // 1. Sort all edges by weight
        Collections.sort(edges);

        // 2. Initialize Union-Find for n islands
        UnionFind uf = new UnionFind(n);

        int minCost = 0;
        int edgesInMST = 0;

        // 3. Iterate through sorted edges
        for (KruskalEdge edge : edges) {
            // If adding this edge does not form a cycle
            if (uf.find(edge.u) != uf.find(edge.v)) {
                uf.union(edge.u, edge.v);
                minCost += edge.weight;
                edgesInMST++;
            }
        }

        // 4. Check if all islands are connected
        // An MST for V vertices must have V-1 edges
        if (edgesInMST == n - 1) {
            return minCost;
        } else {
            return -1; // Not all islands are connected (graph was disconnected)
        }
    }

    public static void main(String[] args) {
        Solution sol = new Solution();
        int n = 4;
        int[][] bridges = {{0,1,1}, {1,2,4}, {0,3,3}, {2,3,2}};
        System.out.println("Min cost to connect islands: " + sol.minCostConnectIslands(n, bridges)); // Expected: 6

        int n2 = 3;
        int[][] bridges2 = {{0,1,1}, {1,2,2}};
        System.out.println("Min cost to connect islands (disconnected): " + sol.minCostConnectIslands(n2, bridges2)); // Expected: -1
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(E log E)` or `O(E log V)` (since `E` can be at most `V^2`, `log E` is roughly `2 log V`). The dominant factor is sorting the edges. The Union-Find operations take nearly constant amortized time `O(α(V))`, where `α` is the inverse Ackermann function.
*   **Space Complexity**: `O(V + E)` for storing edges and the Union-Find data structure.

### Dry Run: Kruskal’s Algorithm

**Input:** `n = 4`, `bridges = {{0,1,1}, {1,2,4}, {0,3,3}, {2,3,2}}`

**Edges (sorted by weight):**
1.  (0,1,1)
2.  (2,3,2)
3.  (0,3,3)
4.  (1,2,4)

| Step | Edge (u,v,w) | `find(u)` | `find(v)` | Action        | `parent` array (simplified) | `minCost` | `edgesInMST` |
|------|--------------|-----------|-----------|---------------|-----------------------------|-----------|--------------|
| Init | -            | -         | -         | -             | `[0,1,2,3]`                 | 0         | 0            |
| 1    | (0,1,1)      | 0         | 1         | `union(0,1)`  | `[0,0,2,3]`                 | 1         | 1            |
| 2    | (2,3,2)      | 2         | 3         | `union(2,3)`  | `[0,0,2,2]`                 | 1+2=3     | 2            |
| 3    | (0,3,3)      | 0         | 2         | `union(0,2)`  | `[0,0,0,0]`                 | 3+3=6     | 3            |
| 4    | (1,2,4)      | 0         | 0         | Skip (cycle)  | `[0,0,0,0]`                 | 6         | 3            |

**Result:** `minCost = 6`. `edgesInMST = 3`, which is `n-1`. All islands are connected.

## Reusable Template for Kruskal’s Algorithm

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

// UnionFind class (can be nested or external)
class UnionFindKruskal {
    private int[] parent;
    private int[] size;
    private int numComponents; // Number of connected components

    public UnionFindKruskal(int n) {
        parent = new int[n];
        size = new int[n];
        numComponents = n;
        for (int i = 0; i < n; i++) {
            parent[i] = i;
            size[i] = 1;
        }
    }

    public int find(int i) {
        if (parent[i] == i) {
            return i;
        }
        return parent[i] = find(parent[i]);
    }

    public boolean union(int i, int j) {
        int rootI = find(i);
        int rootJ = find(j);

        if (rootI != rootJ) {
            if (size[rootI] < size[rootJ]) {
                parent[rootI] = rootJ;
                size[rootJ] += size[rootI];
            } else {
                parent[rootJ] = rootI;
                size[rootI] += size[rootJ];
            }
            numComponents--;
            return true; // Union successful
        }
        return false; // Already in the same set
    }

    public int getNumComponents() {
        return numComponents;
    }
}

class KruskalsAlgorithm {

    static class Edge implements Comparable<Edge> {
        int u, v, weight;

        public Edge(int u, int v, int weight) {
            this.u = u;
            this.v = v;
            this.weight = weight;
        }

        @Override
        public int compareTo(Edge other) {
            return Integer.compare(this.weight, other.weight);
        }
    }

    /**
     * Finds the Minimum Spanning Tree (MST) of a connected, undirected, weighted graph
     * using Kruskal's Algorithm.
     * @param numVertices The total number of vertices in the graph (0-indexed).
     * @param edgesList A list of all edges in the graph.
     * @return The total minimum cost of the MST, or -1 if the graph is not connected.
     */
    public int findMinimumSpanningTreeCost(int numVertices, List<Edge> edgesList) {
        // 1. Sort all edges by weight
        Collections.sort(edgesList);

        // 2. Initialize Union-Find
        UnionFindKruskal uf = new UnionFindKruskal(numVertices);

        int minCost = 0;
        int edgesInMST = 0;

        // 3. Iterate through sorted edges
        for (Edge edge : edgesList) {
            // If adding this edge does not form a cycle
            if (uf.union(edge.u, edge.v)) {
                minCost += edge.weight;
                edgesInMST++;
            }
        }

        // 4. Check if all vertices are connected (MST must have V-1 edges)
        if (edgesInMST == numVertices - 1) {
            return minCost;
        } else {
            return -1; // Graph is disconnected
        }
    }
}
```

## How to Recognize Kruskal’s Algorithm in Interviews

Look for these clues:

*   **Data Structure**: Connected, undirected, weighted graph.
*   **Goal**: Find a **Minimum Spanning Tree (MST)**.
*   **Keywords**: "Minimum cost to connect all points", "cheapest way to link all nodes", "network design", "spanning tree with minimum weight".
*   **Graph Type**: Often preferred for **sparse graphs**.

## Common Mistakes

### Mistake 1: Not Sorting Edges Correctly

The greedy choice of Kruskal's algorithm depends on processing edges in increasing order of weight. Incorrect sorting will lead to an incorrect MST.

### Mistake 2: Incorrect Union-Find Implementation

An inefficient or incorrect Union-Find implementation (e.g., without path compression or union by rank/size) will degrade the performance of Kruskal's algorithm significantly.

### Mistake 3: Not Handling Disconnected Graphs

If the graph is disconnected, Kruskal's will find an MST for each connected component (a Minimum Spanning Forest). If the problem requires a single MST for the entire graph, you must check if `edgesInMST == numVertices - 1` at the end.

### Mistake 4: Off-by-one Errors in Node Indexing

Ensure that node indices (0-indexed vs. 1-indexed) are handled consistently between the problem input and your Union-Find implementation.

## Kruskal’s vs. Prim’s Algorithm

Both Kruskal's and Prim's algorithms find the MST of a graph, but they use different approaches:

| Feature           | Kruskal’s Algorithm           | Prim’s Algorithm              |
|-------------------|-------------------------------|-------------------------------|
| **Approach**      | Grows a forest of trees, merging them. | Grows a single tree from a starting vertex. |
| **Data Structure**| Union Find (DSU), sorted list of edges. | Priority Queue, `minCost` array, `inMST` array. |
| **Graph Type**    | Best for **sparse graphs** (E close to V). | Best for **dense graphs** (E close to V^2). |
| **Time Complexity** | `O(E log E)` or `O(E log V)` (due to sorting edges). | `O(E log V)` or `O(E + V log V)` with Fibonacci heap. |
| **Core Idea**     | Add cheapest edge that doesn't form a cycle. | Add cheapest edge connecting tree to non-tree vertex. |

## Practice Problems for This Pattern

1.  **Connecting Cities With Minimum Cost** (LeetCode 1135) - Direct application of MST.
2.  **Min Cost to Connect All Points** (LeetCode 1584) - Connect points in a 2D plane with minimum Manhattan distance.
3.  **Kruskal's Algorithm** (various competitive programming platforms) - Direct implementation.

## Interview Script You Can Reuse

```text
"This problem asks for the minimum cost to connect all components, which is a classic Minimum Spanning Tree (MST) problem. I'll use Kruskal's Algorithm, which is a greedy approach. First, I'll list all edges and sort them by their weights in ascending order. Then, I'll use a Union-Find data structure to keep track of connected components. I'll iterate through the sorted edges, and for each edge, if its two endpoints are not already in the same connected component (checked using `find`), I'll add this edge to my MST, merge their components using `union`, and add its weight to the total cost. I'll continue this until I've added V-1 edges or run out of edges. Finally, I'll check if all vertices are connected. This approach yields an O(E log E) time complexity, primarily due to sorting, and O(V + E) space complexity."
```

## Final Takeaways

*   **Kruskal’s Algorithm** finds the **MST** of a connected, undirected, weighted graph.
*   It's a **greedy algorithm** that builds the MST by adding edges in increasing order of weight.
*   Relies on **Union-Find** to efficiently detect cycles.
*   Achieves **`O(E log E)` time complexity** and **`O(V + E)` space complexity**.
*   Ideal for **sparse graphs** and problems requiring minimum cost connectivity.

Mastering Kruskal's Algorithm is essential for solving optimization problems related to network design and infrastructure with minimum cost, especially when dealing with sparse graphs.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
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
