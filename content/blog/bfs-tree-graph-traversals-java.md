---
title: "BFS (Breadth First Search) in Java: Level-Order and Shortest Path"
description: "Master Breadth First Search (BFS) in Java for traversing trees and graphs. Learn its intuition, iterative implementation, dry runs, and complexity analysis for level-order traversal and shortest path problems."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "bfs", "breadth first search", "tree traversal", "graph traversal", "shortest path", "level order", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to Breadth First Search (BFS)

**Breadth First Search (BFS)** is a fundamental algorithm for traversing or searching tree or graph data structures. Unlike DFS, which explores as deeply as possible along each branch, BFS explores all of the neighbor nodes at the present depth before moving on to the nodes at the next depth level. Imagine throwing a stone into a pond; the ripples spread outwards in layers. BFS works similarly, exploring layer by layer.

BFS is particularly useful for finding the shortest path in an unweighted graph, level-order traversal of trees, and solving problems that involve exploring nodes in increasing order of their distance from a source.

## When Should You Think About BFS?

Consider using Breadth First Search when:

*   You need to **traverse all nodes** in a tree or graph, layer by layer.
*   You need to find the **shortest path** between two nodes in an **unweighted graph**.
*   You need to perform **level-order traversal** of a tree.
*   You need to find all nodes at a **certain depth** or distance from a source node.
*   Problems involve **network broadcasting**, finding connected components, or web crawlers.
*   You need to solve problems where the order of exploration matters (e.g., minimum number of moves).

## Core Concept of BFS

BFS is typically implemented using a **queue** data structure. The core idea is to:

1.  Start at a given node (root for trees, or any arbitrary node for graphs).
2.  Add the starting node to a queue and mark it as visited.
3.  While the queue is not empty:
    a.  Dequeue a node.
    b.  Process the dequeued node (e.g., add to result list, check for target).
    c.  Enqueue all its unvisited neighbors and mark them as visited.
4.  Repeat until the queue is empty.

### For Trees

BFS naturally performs a **level-order traversal**, visiting all nodes at depth `d` before moving to depth `d+1`.

### For Graphs

For graphs, we need to keep track of visited nodes to avoid infinite loops in case of cycles and to ensure each node is processed only once. A `boolean[] visited` array or `HashSet<Node>` is commonly used.

## Example 1: Level-Order Traversal of a Binary Tree

Given the `root` of a binary tree, return the level-order traversal of its nodes' values. (i.e., from left to right, level by level).

#### Iterative Approach (using Queue)

```java
import java.util.ArrayList;
import java.util.LinkedList;
import java.util.List;
import java.util.Queue;

class TreeNode {
    int val;
    TreeNode left;
    TreeNode right;
    TreeNode() {}
    TreeNode(int val) { this.val = val; }
    TreeNode(int val, TreeNode left, TreeNode right) {
        this.val = val;
        this.left = left;
        this.right = right;
    }
}

class Solution {
    public List<List<Integer>> levelOrder(TreeNode root) {
        List<List<Integer>> result = new ArrayList<>();
        if (root == null) {
            return result;
        }

        Queue<TreeNode> queue = new LinkedList<>();
        queue.offer(root);

        while (!queue.isEmpty()) {
            int levelSize = queue.size();
            List<Integer> currentLevel = new ArrayList<>();
            for (int i = 0; i < levelSize; i++) {
                TreeNode node = queue.poll();
                currentLevel.add(node.val);

                if (node.left != null) {
                    queue.offer(node.left);
                }
                if (node.right != null) {
                    queue.offer(node.right);
                }
            }
            result.add(currentLevel);
        }
        return result;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, where `n` is the number of nodes, as each node is enqueued and dequeued exactly once.
*   **Space Complexity**: `O(w)`, where `w` is the maximum width of the tree (maximum number of nodes at any level). In the worst case (a complete binary tree), `w` can be `n/2`, so `O(n)`.

### Dry Run: Level-Order Traversal

**Input:** Tree `[3, 9, 20, null, null, 15, 7]`

```
      3
     / \
    9  20
      /  \
     15   7
```

| Step | Queue (front to back) | `levelSize` | `currentLevel` | `result` |
|------|-----------------------|-------------|----------------|----------|
| Init | [3]                   | -           | -              | []       |
| 1    | [9, 20]               | 1           | [3]            | [[3]]    | (Dequeue 3, Enqueue 9, 20) |
| 2    | [15, 7]               | 2           | [9, 20]        | [[3], [9, 20]] | (Dequeue 9, Enqueue 15; Dequeue 20, Enqueue 7) |
| 3    | []                    | 2           | [15, 7]        | [[3], [9, 20], [15, 7]] | (Dequeue 15; Dequeue 7) |
| End  | []                    | -           | -              | [[3], [9, 20], [15, 7]] | Queue empty. |

**Result:** `[[3], [9, 20], [15, 7]]`

## Example 2: BFS on a Graph (Shortest Path in Unweighted Graph)

Given an unweighted graph and a source node `s`, find the shortest distance from `s` to all other reachable nodes.

#### Adjacency List Representation

```java
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedList;
import java.util.List;
import java.util.Queue;

class GraphBFS {
    private int V; // Number of vertices
    private List<List<Integer>> adj; // Adjacency list

    GraphBFS(int v) {
        V = v;
        adj = new ArrayList<>(v);
        for (int i = 0; i < v; ++i) {
            adj.add(new ArrayList<>());
        }
    }

    void addEdge(int v, int w) {
        adj.get(v).add(w);
        adj.get(w).add(v); // For undirected graph
    }

    public int[] shortestPath(int startNode) {
        int[] dist = new int[V];
        Arrays.fill(dist, -1); // Initialize distances to -1 (unreachable)
        boolean[] visited = new boolean[V];
        Queue<Integer> queue = new LinkedList<>();

        queue.offer(startNode);
        visited[startNode] = true;
        dist[startNode] = 0;

        while (!queue.isEmpty()) {
            int u = queue.poll();

            for (int v : adj.get(u)) {
                if (!visited[v]) {
                    visited[v] = true;
                    dist[v] = dist[u] + 1;
                    queue.offer(v);
                }
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        GraphBFS g = new GraphBFS(6); // 6 vertices numbered 0 to 5
        g.addEdge(0, 1);
        g.addEdge(0, 2);
        g.addEdge(1, 3);
        g.addEdge(2, 4);
        g.addEdge(3, 5);
        g.addEdge(4, 5);

        int[] distances = g.shortestPath(0);
        System.out.println("Shortest distances from node 0: " + Arrays.toString(distances)); // Expected: [0, 1, 1, 2, 2, 3]
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(V + E)`, where `V` is the number of vertices and `E` is the number of edges. Each vertex and edge is visited at most once.
*   **Space Complexity**: `O(V)` for the `visited` array, `dist` array, and the queue.

### Dry Run: BFS on Graph (Shortest Path)

**Input:** Graph with 6 vertices, edges (0,1), (0,2), (1,3), (2,4), (3,5), (4,5). Start node = 0.

```
    0
   / \
  1   2
  |   |
  3---4
   \ /
    5
```

| Step | Queue (front) | Dequeued `u` | Neighbors of `u` | `dist` array state (relevant) | Notes |
|------|---------------|--------------|------------------|-------------------------------|-------|
| Init | [0]           | -            | -                | `dist[0]=0`, others -1        | `visited[0]=true` |
| 1    | [1, 2]        | 0            | 1, 2             | `dist[1]=1, dist[2]=1`        | Enqueue 1, 2. `visited[1]=true, visited[2]=true` |
| 2    | [2, 3]        | 1            | 0, 3             | `dist[3]=2`                   | Dequeue 1. 0 visited. Enqueue 3. `visited[3]=true` |
| 3    | [3, 4]        | 2            | 0, 4             | `dist[4]=2`                   | Dequeue 2. 0 visited. Enqueue 4. `visited[4]=true` |
| 4    | [4, 5]        | 3            | 1, 5             | `dist[5]=3`                   | Dequeue 3. 1 visited. Enqueue 5. `visited[5]=true` |
| 5    | [5]           | 4            | 2, 5             | `dist[5]=3` (no change)       | Dequeue 4. 2 visited. 5 visited. |
| 6    | []            | 5            | 3, 4             | -                             | Dequeue 5. 3, 4 visited. |
| End  | []            | -            | -                | `[0, 1, 1, 2, 2, 3]`          | Queue empty. |

**Result:** `[0, 1, 1, 2, 2, 3]` (distances from node 0)

## Reusable Template for BFS

```java
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedList;
import java.util.List;
import java.util.Queue;

class BFSTemplate {

    // --- Tree Node Definition ---
    static class TreeNode {
        int val;
        TreeNode left;
        TreeNode right;
        TreeNode(int val) { this.val = val; }
    }

    // --- Graph Node Definition (for adjacency list) ---
    // Assuming graph nodes are 0-indexed integers

    // BFS for Tree (Level-order traversal example)
    public List<List<Integer>> levelOrderTraversal(TreeNode root) {
        List<List<Integer>> result = new ArrayList<>();
        if (root == null) {
            return result;
        }

        Queue<TreeNode> queue = new LinkedList<>();
        queue.offer(root);

        while (!queue.isEmpty()) {
            int levelSize = queue.size();
            List<Integer> currentLevel = new ArrayList<>();
            for (int i = 0; i < levelSize; i++) {
                TreeNode node = queue.poll();
                currentLevel.add(node.val);

                if (node.left != null) {
                    queue.offer(node.left);
                }
                if (node.right != null) {
                    queue.offer(node.right);
                }
            }
            result.add(currentLevel);
        }
        return result;
    }

    // BFS for Graph (Shortest path in unweighted graph example)
    public int[] shortestPathInUnweightedGraph(int V, List<List<Integer>> adj, int startNode) {
        int[] dist = new int[V];
        Arrays.fill(dist, -1); // Initialize distances to -1 (unreachable)
        boolean[] visited = new boolean[V];
        Queue<Integer> queue = new LinkedList<>();

        queue.offer(startNode);
        visited[startNode] = true;
        dist[startNode] = 0;

        while (!queue.isEmpty()) {
            int u = queue.poll();

            for (int v : adj.get(u)) {
                if (!visited[v]) {
                    visited[v] = true;
                    dist[v] = dist[u] + 1;
                    queue.offer(v);
                }
            }
        }
        return dist;
    }
}
```

## How to Recognize BFS in Interviews

Look for these clues:

*   **Data Structure**: Trees or Graphs.
*   **Goal**: Explore nodes layer by layer, find the shortest path in an unweighted graph, or find all nodes at a certain distance.
*   **Keywords**: "Level-order traversal", "shortest path" (especially in unweighted graphs), "minimum depth", "minimum number of moves", "connected components" (can be done with both BFS/DFS).
*   **Constraint**: Often when `O(V)` space for the queue is acceptable.

## Common Mistakes

### Mistake 1: Not Handling Visited Nodes in Graphs

Forgetting to use a `visited` set/array in graphs can lead to infinite loops if cycles are present, or redundant computations.

### Mistake 2: Incorrect Queue Operations

Ensure you are using `offer()` to add elements and `poll()` to remove elements from the queue, and `peek()` to inspect the front element without removing it.

### Mistake 3: Not Handling Disconnected Graphs

For graphs, if you only start BFS from one node, you might not visit all nodes if the graph is disconnected. You need to iterate through all nodes and start BFS from unvisited ones to cover all components (similar to DFS).

### Mistake 4: Confusing BFS with DFS

Remember that BFS uses a queue and explores level by level, while DFS uses a stack (or recursion) and explores depth-first. Choose the appropriate algorithm based on the problem requirements.

## BFS vs. DFS

| Feature           | BFS (Breadth First Search)    | DFS (Depth First Search)      |
|-------------------|-------------------------------|-------------------------------|
| **Traversal Order** | Explores all neighbors at the current depth before moving to the next depth level. | Explores as far as possible along each branch before backtracking. |
| **Data Structure**| Queue                         | Stack (explicit or recursion call stack) |
| **Applications**  | Shortest path in unweighted graphs, finding all nodes at a certain depth, level-order traversal, network broadcasting, web crawlers. | Pathfinding, cycle detection, topological sort, connected components, backtracking, tree traversals (pre/in/post-order). |
| **Time Complexity** | `O(V + E)` for graphs, `O(N)` for trees. | `O(V + E)` for graphs, `O(N)` for trees. |
| **Space Complexity**| `O(V)` for queue (stores nodes at current level). | `O(V)` or `O(h)` (height) for recursion stack/explicit stack. |

## Practice Problems for This Pattern

1.  **Binary Tree Level Order Traversal** (LeetCode 102) - Classic tree BFS.
2.  **Shortest Path in Binary Matrix** (LeetCode 1091) - BFS for shortest path in a grid.
3.  **Rotting Oranges** (LeetCode 994) - Multi-source BFS application.
4.  **Word Ladder** (LeetCode 127) - BFS for shortest transformation sequence.
5.  **Number of Islands** (LeetCode 200) - Can be solved with both BFS and DFS.

## Interview Script You Can Reuse

```text
"This problem involves exploring nodes layer by layer (or finding the shortest path in an unweighted graph), which suggests a BFS approach. I'll use a queue to manage the nodes to visit. I'll start by adding the source node to the queue and marking it as visited. Then, in a loop, I'll dequeue a node, process it, and enqueue all its unvisited neighbors, marking them as visited as I add them. This ensures that nodes are explored in increasing order of their distance from the source. This approach guarantees an O(V + E) time complexity for graphs (or O(N) for trees) and O(V) space complexity for the queue and visited array."
```

## Final Takeaways

*   **BFS** explores **level by level** using a **queue**.
*   Ideal for **shortest path in unweighted graphs** and **level-order tree traversals**.
*   Achieves **`O(V + E)` time complexity** and **`O(V)` space complexity**.
*   Requires careful handling of **visited nodes** in graphs.

Mastering BFS is fundamental for solving a wide range of tree and graph problems efficiently, especially those related to shortest paths and layered exploration.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
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
