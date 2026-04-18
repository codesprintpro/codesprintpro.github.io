---
title: "Union Find (DSU) in Java: Connectivity and Cycle Detection"
description: "Master the Union Find (Disjoint Set Union) data structure in Java for efficiently managing disjoint sets, checking connectivity, and detecting cycles in undirected graphs. Learn its intuition, implementation, dry runs, and complexity analysis."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "union find", "disjoint set union", "dsu", "graph", "connectivity", "cycle detection", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to Union Find (Disjoint Set Union)

The **Union Find** data structure, also known as **Disjoint Set Union (DSU)**, is a powerful and efficient data structure that keeps track of a set of elements partitioned into a number of disjoint (non-overlapping) subsets. It provides two primary operations:

1.  **`find(i)`**: Returns the representative (or root) of the set that element `i` belongs to. This can be used to check if two elements are in the same set.
2.  **`union(i, j)`**: Merges the sets containing elements `i` and `j` into a single set.

DSU is particularly useful in problems involving connectivity in graphs, such as finding connected components, detecting cycles in undirected graphs, and implementing algorithms like Kruskal's for Minimum Spanning Trees.

## When Should You Think About Union Find?

Consider using the Union Find pattern when:

*   You need to manage a collection of **disjoint sets**.
*   You frequently need to **check if two elements belong to the same set** (connectivity).
*   You frequently need to **merge two sets** into one.
*   You need to **detect cycles in an undirected graph**.
*   Problems involve **connected components** or **spanning trees**.
*   You need an efficient way to perform these operations, typically aiming for nearly constant time complexity.

## Core Concepts of Union Find

DSU is typically implemented using an array (or map) to store the parent of each element. Each set is represented as a tree, where the root of the tree is the representative of the set.

To optimize the performance of `find` and `union` operations, two techniques are commonly used:

1.  **Path Compression (for `find`)**: When `find(i)` is called, it traverses up the tree to find the root. During this traversal, it can flatten the tree by making every node on the path point directly to the root. This significantly reduces the height of the tree, speeding up future `find` operations.
2.  **Union by Rank/Size (for `union`)**: When merging two sets, attach the root of the smaller/shorter tree to the root of the larger/taller tree. This helps keep the trees relatively flat, preventing them from becoming skewed and maintaining logarithmic height. 
### Example: Connected Components in an Undirected Graph

Given `n` nodes labeled from `0` to `n-1` and a list of undirected `edges` (where `edges[i] = [u, v]` indicates a connection between `u` and `v`), find the number of connected components in the graph.

#### Brute Force Approach (using BFS/DFS)

A brute-force approach would involve iterating through all nodes and running BFS or DFS from each unvisited node. Each time a new traversal starts, it signifies a new connected component.

```java
import java.util.ArrayList;
import java.util.List;
import java.util.Stack;

class SolutionBFSDFS {
    public int countComponents(int n, int[][] edges) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            adj.add(new ArrayList<>());
        }
        for (int[] edge : edges) {
            adj.get(edge[0]).add(edge[1]);
            adj.get(edge[1]).add(edge[0]);
        }

        boolean[] visited = new boolean[n];
        int count = 0;

        for (int i = 0; i < n; i++) {
            if (!visited[i]) {
                dfs(i, adj, visited); // Or bfs(i, adj, visited);
                count++;
            }
        }
        return count;
    }

    private void dfs(int u, List<List<Integer>> adj, boolean[] visited) {
        visited[u] = true;
        for (int v : adj.get(u)) {
            if (!visited[v]) {
                dfs(v, adj, visited);
            }
        }
    }
    // BFS implementation would use a Queue instead of recursion/stack
}
```

**Complexity:**

*   **Time Complexity**: `O(V + E)`, where `V` is the number of vertices and `E` is the number of edges. Each vertex and edge is visited at most once.
*   **Space Complexity**: `O(V + E)` for adjacency list and `O(V)` for visited array and recursion stack/queue.

#### Optimized with Union Find

```java
class UnionFind {
    private int[] parent;
    private int[] rank; // or size
    private int count; // Number of disjoint sets

    public UnionFind(int n) {
        parent = new int[n];
        rank = new int[n];
        count = n; // Initially, each node is its own set
        for (int i = 0; i < n; i++) {
            parent[i] = i; // Each element is its own parent
            rank[i] = 0;   // Initial rank is 0
        }
    }

    // Find operation with Path Compression
    public int find(int i) {
        if (parent[i] == i) {
            return i;
        }
        return parent[i] = find(parent[i]);
    }

    // Union operation with Union by Rank
    public void union(int i, int j) {
        int rootI = find(i);
        int rootJ = find(j);

        if (rootI != rootJ) {
            if (rank[rootI] < rank[rootJ]) {
                parent[rootI] = rootJ;
            } else if (rank[rootJ] < rank[rootI]) {
                parent[rootJ] = rootI;
            } else {
                parent[rootJ] = rootI;
                rank[rootI]++;
            }
            count--; // Decrement count of disjoint sets
        }
    }

    public int getCount() {
        return count;
    }
}

class Solution {
    public int countComponents(int n, int[][] edges) {
        UnionFind uf = new UnionFind(n);
        for (int[] edge : edges) {
            uf.union(edge[0], edge[1]);
        }
        return uf.getCount();
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(E * α(V))`, where `E` is the number of edges, `V` is the number of vertices, and `α` is the inverse Ackermann function, which grows extremely slowly and is practically a constant (less than 5 for any realistic input size). So, effectively `O(E)`. Initialization is `O(V)`.
*   **Space Complexity**: `O(V)` for `parent` and `rank` arrays.

### Dry Run: Connected Components with Union Find

**Input:** `n = 5`, `edges = [[0,1], [1,2], [3,4]]`

| Step | Operation | `parent` array state (index: value) | `rank` array state | `count` | Notes |
|------|-----------|-------------------------------------|--------------------|---------|-------|
| Init | -         | `[0,1,2,3,4]`                       | `[0,0,0,0,0]`      | 5       | Each node is its own set |
| 1    | `union(0,1)` | `[0,0,2,3,4]`                       | `[1,0,0,0,0]`      | 4       | 0 becomes parent of 1, rank[0]++ |
| 2    | `union(1,2)` | `[0,0,0,3,4]`                       | `[1,0,0,0,0]`      | 3       | 0 (root of 1) becomes parent of 2, ranks unchanged |
| 3    | `union(3,4)` | `[0,0,0,3,3]`                       | `[1,0,0,1,0]`      | 2       | 3 becomes parent of 4, rank[3]++ |

**Result:** `uf.getCount() = 2`

## Reusable Template for Union Find (DSU)

```java
class UnionFindDSU {
    private int[] parent;
    private int[] size; // Using size for union optimization
    private int count;  // Number of disjoint sets

    public UnionFindDSU(int n) {
        parent = new int[n];
        size = new int[n];
        count = n;
        for (int i = 0; i < n; i++) {
            parent[i] = i;
            size[i] = 1; // Each set initially has size 1
        }
    }

    // Find operation with Path Compression
    public int find(int i) {
        if (parent[i] == i) {
            return i;
        }
        return parent[i] = find(parent[i]);
    }

    // Union operation with Union by Size
    public void union(int i, int j) {
        int rootI = find(i);
        int rootJ = find(j);

        if (rootI != rootJ) {
            // Attach smaller tree under root of larger tree
            if (size[rootI] < size[rootJ]) {
                parent[rootI] = rootJ;
                size[rootJ] += size[rootI];
            } else {
                parent[rootJ] = rootI;
                size[rootI] += size[rootJ];
            }
            count--; // One less disjoint set after union
        }
    }

    // Returns the number of disjoint sets
    public int getCount() {
        return count;
    }

    // Checks if two elements are in the same set
    public boolean areConnected(int i, int j) {
        return find(i) == find(j);
    }
}
```

## How to Recognize Union Find in Interviews

Look for these clues:

*   **Dynamic Connectivity**: Problems where you need to frequently check connectivity between elements and merge groups of elements.
*   **Graph Problems**: Especially in undirected graphs, for finding connected components, cycle detection, or algorithms like Kruskal's MST.
*   **Disjoint Sets**: The problem explicitly mentions or implies partitioning elements into non-overlapping sets.
*   **Keywords**: "Connected components", "union", "merge", "same set", "group", "friend circles", "redundant connection".
*   **Efficiency**: When `O(V + E)` or nearly constant time per operation is required for connectivity checks and merges.

## Common Mistakes

### Mistake 1: Not Implementing Path Compression

Without path compression, the `find` operation can take `O(V)` time in the worst case (a skewed tree), degrading overall performance.

### Mistake 2: Not Implementing Union by Rank/Size

Without union by rank or size, the `union` operation can also lead to skewed trees, increasing the height and thus the time for `find` operations.

### Mistake 3: Incorrectly Updating `count`

Remember to decrement the `count` of disjoint sets only when a successful `union` operation occurs (i.e., when `rootI != rootJ`).

### Mistake 4: Off-by-one Errors in Array Indexing

Ensure that the `parent` and `rank`/`size` arrays are correctly sized and indexed, especially when nodes are 0-indexed or 1-indexed.

## Union Find vs. BFS/DFS for Connectivity

| Feature           | Union Find (DSU)              | BFS/DFS                       |
|-------------------|-------------------------------|-------------------------------|
| **Primary Use**   | Dynamic connectivity, merging sets, cycle detection (undirected). | Graph traversal, shortest path (BFS), pathfinding (DFS), connected components. |
| **Operations**    | `find`, `union`, `getCount`   | `traverse`, `explore`         |
| **Time Complexity** | `O(α(V))` amortized per operation (nearly constant). `O(V + E * α(V))` total. | `O(V + E)` for a full traversal. |
| **Space Complexity**| `O(V)`                        | `O(V + E)` (adj list) + `O(V)` (visited/queue/stack) |
| **Dynamic Changes** | Excellent for dynamic updates (adding edges and checking connectivity). | Typically re-runs traversal for each query or change. |

Union Find is generally more efficient for problems where you have many `union` and `find` operations, especially when the graph structure is changing or you need to query connectivity frequently.

## Practice Problems for This Pattern

1.  **Number of Connected Components in an Undirected Graph** (LeetCode 323) - Classic application.
2.  **Redundant Connection** (LeetCode 684) - Detect cycles in an undirected graph.
3.  **Graph Valid Tree** (LeetCode 261) - Determine if a graph is a valid tree using DSU.
4.  **Friend Circles** (LeetCode 547) - Find the number of friend circles (connected components).
5.  **Longest Consecutive Sequence** (LeetCode 128) - Can be solved using DSU by treating consecutive numbers as connected.

## Interview Script You Can Reuse

```text
"This problem involves checking connectivity and potentially merging groups of elements, which is a perfect fit for the Union Find (Disjoint Set Union) data structure. I'll initialize a `parent` array where each element is initially its own parent, and a `size` (or `rank`) array for optimization. The `find` operation will use path compression to flatten the tree, and the `union` operation will use union by size/rank to keep the trees balanced. Each time I process an edge, I'll perform a `union` operation on the two connected nodes. If they are already in the same set, it indicates a cycle. The number of disjoint sets can be tracked by a `count` variable, decremented on each successful union. This approach provides nearly constant amortized time complexity per operation, making it highly efficient for large datasets."
```

## Final Takeaways

*   **Union Find (DSU)** manages **disjoint sets** efficiently.
*   Key operations: `find` (with **path compression**) and `union` (with **union by rank/size**).
*   Achieves **nearly `O(1)` amortized time complexity** per operation.
*   Crucial for **connectivity problems**, **cycle detection in undirected graphs**, and **Kruskal's MST**.
*   Provides an elegant solution for dynamically tracking connected components.

Mastering Union Find is essential for optimizing graph-related problems that involve dynamic connectivity queries.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
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
