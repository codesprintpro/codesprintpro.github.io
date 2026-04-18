---
title: "DFS (Depth First Search) in Java: Tree and Graph Traversals"
description: "Master Depth First Search (DFS) in Java for traversing trees and graphs. Learn its intuition, iterative and recursive implementations, dry runs, and complexity analysis for various applications."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "dfs", "depth first search", "tree traversal", "graph traversal", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to Depth First Search (DFS)

**Depth First Search (DFS)** is a fundamental algorithm for traversing or searching tree or graph data structures. It explores as far as possible along each branch before backtracking. Imagine exploring a maze: DFS is like going down one path as far as you can, and if it's a dead end, you backtrack to the last junction and try another path. This 'deep' exploration is what gives it its name.

DFS is widely used in various applications, including finding connected components, topological sorting, pathfinding, and solving puzzles like mazes or Sudoku.

## When Should You Think About DFS?

Consider using Depth First Search when:

*   You need to **traverse all nodes** in a tree or graph.
*   You need to **find a path** between two nodes.
*   You need to **detect cycles** in a graph.
*   You need to perform **topological sorting** (for Directed Acyclic Graphs).
*   You need to find **connected components** in a graph.
*   Problems involve **backtracking** or exploring all possible paths (e.g., permutations, combinations, solving N-Queens).
*   The problem requires **pre-order, in-order, or post-order traversal** for trees.

## Core Concept of DFS

DFS can be implemented using either recursion (which implicitly uses the call stack) or an explicit stack data structure. The core idea is to:

1.  Start at a given node (root for trees, or any arbitrary node for graphs).
2.  Mark the current node as visited.
3.  Explore one of its unvisited neighbors. If no unvisited neighbors exist, backtrack.
4.  Repeat until all reachable nodes are visited.

### For Trees

Tree traversals (pre-order, in-order, post-order) are natural applications of DFS:

*   **Pre-order**: Visit node, then left subtree, then right subtree.
*   **In-order**: Visit left subtree, then node, then right subtree (for Binary Search Trees, this yields sorted elements).
*   **Post-order**: Visit left subtree, then right subtree, then node.

### For Graphs

For graphs, we need to keep track of visited nodes to avoid infinite loops in case of cycles. A `boolean[] visited` array or `HashSet<Node>` is commonly used.

## Example 1: Pre-order Traversal of a Binary Tree

Given the `root` of a binary tree, return the pre-order traversal of its nodes' values.

#### Recursive Approach

```java
import java.util.ArrayList;
import java.util.List;

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
    public List<Integer> preorderTraversal(TreeNode root) {
        List<Integer> result = new ArrayList<>();
        dfsPreorder(root, result);
        return result;
    }

    private void dfsPreorder(TreeNode node, List<Integer> result) {
        if (node == null) {
            return;
        }
        result.add(node.val);      // Visit node
        dfsPreorder(node.left, result);  // Traverse left
        dfsPreorder(node.right, result); // Traverse right
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, where `n` is the number of nodes, as each node is visited exactly once.
*   **Space Complexity**: `O(h)`, where `h` is the height of the tree, due to the recursion stack. In the worst case (skewed tree), `h` can be `n`, so `O(n)`.

### Dry Run: Pre-order Traversal (Recursive)

**Input:** Tree `[1, null, 2, 3]` (Root 1, Right child 2, Left child of 2 is 3)

```
    1
     \
      2
     /
    3
```

| Call Stack | `node` | `result` | Action |
|------------|--------|----------|--------|
| `dfs(1)`   | 1      | []       | Add 1 to result: `[1]` |
| `dfs(1.left)` | null   | `[1]`    | Return |
| `dfs(1.right)`| 2      | `[1]`    | Add 2 to result: `[1, 2]` |
| `dfs(2.left)` | 3      | `[1, 2]` | Add 3 to result: `[1, 2, 3]` |
| `dfs(3.left)` | null   | `[1, 2, 3]` | Return |
| `dfs(3.right)`| null   | `[1, 2, 3]` | Return |
| `dfs(2.right)`| null   | `[1, 2, 3]` | Return |
| Return     |        | `[1, 2, 3]` | Final result |

**Result:** `[1, 2, 3]`

#### Iterative Approach (using explicit Stack)

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Stack;

class Solution {
    public List<Integer> preorderTraversalIterative(TreeNode root) {
        List<Integer> result = new ArrayList<>();
        if (root == null) {
            return result;
        }

        Stack<TreeNode> stack = new Stack<>();
        stack.push(root);

        while (!stack.isEmpty()) {
            TreeNode node = stack.pop();
            result.add(node.val);

            // Push right child first, then left child, so left is processed first (LIFO)
            if (node.right != null) {
                stack.push(node.right);
            }
            if (node.left != null) {
                stack.push(node.left);
            }
        }
        return result;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, as each node is pushed and popped exactly once.
*   **Space Complexity**: `O(h)`, where `h` is the height of the tree, due to the explicit stack. In the worst case (skewed tree), `h` can be `n`, so `O(n)`.

## Example 2: DFS on a Graph (Connected Components)

Given an undirected graph, find the number of connected components.

#### Adjacency List Representation

```java
import java.util.ArrayList;
import java.util.List;
import java.util.Stack;

class GraphDFS {
    private int V; // Number of vertices
    private List<List<Integer>> adj; // Adjacency list

    GraphDFS(int v) {
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

    // Recursive DFS helper
    void dfsRecursive(int v, boolean[] visited) {
        visited[v] = true;
        // System.out.print(v + " "); // Optional: print visited node

        for (int neighbor : adj.get(v)) {
            if (!visited[neighbor]) {
                dfsRecursive(neighbor, visited);
            }
        }
    }

    // Iterative DFS helper
    void dfsIterative(int startNode, boolean[] visited) {
        Stack<Integer> stack = new Stack<>();
        stack.push(startNode);
        visited[startNode] = true;

        while (!stack.isEmpty()) {
            int current = stack.pop();
            // System.out.print(current + " "); // Optional: print visited node

            for (int neighbor : adj.get(current)) {
                if (!visited[neighbor]) {
                    visited[neighbor] = true;
                    stack.push(neighbor);
                }
            }
        }
    }

    // Main function to find connected components
    public int countConnectedComponents() {
        boolean[] visited = new boolean[V];
        int count = 0;
        for (int i = 0; i < V; ++i) {
            if (!visited[i]) {
                dfsRecursive(i, visited); // Or dfsIterative(i, visited);
                count++;
            }
        }
        return count;
    }

    public static void main(String[] args) {
        GraphDFS g = new GraphDFS(5); // 5 vertices numbered 0 to 4
        g.addEdge(0, 1);
        g.addEdge(1, 2);
        g.addEdge(3, 4);

        System.out.println("Number of connected components: " + g.countConnectedComponents()); // Expected: 2
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(V + E)`, where `V` is the number of vertices and `E` is the number of edges. Each vertex and edge is visited at most once.
*   **Space Complexity**: `O(V)` for the `visited` array and the recursion stack (or explicit stack).

### Dry Run: DFS on Graph (Recursive)

**Input:** Graph with 5 vertices, edges (0,1), (1,2), (3,4)

```
0 -- 1 -- 2    3 -- 4
```

| Call Stack | `v` | `visited` array state | Action |
|------------|-----|-----------------------|--------|
| `countCC()`| -   | `[F,F,F,F,F]`         | `i=0`, `!visited[0]` is true. `count=0` |
| `dfs(0)`   | 0   | `[T,F,F,F,F]`         | Mark 0 visited. Neighbors of 0: {1} |
| `dfs(1)`   | 1   | `[T,T,F,F,F]`         | Mark 1 visited. Neighbors of 1: {0, 2} |
| `dfs(0)`   | 0   | `[T,T,F,F,F]`         | 0 already visited. Return. |
| `dfs(2)`   | 2   | `[T,T,T,F,F]`         | Mark 2 visited. Neighbors of 2: {1} |
| `dfs(1)`   | 1   | `[T,T,T,F,F]`         | 1 already visited. Return. |
| Return     |     | `[T,T,T,F,F]`         | `dfs(2)` returns. |
| Return     |     | `[T,T,T,F,F]`         | `dfs(1)` returns. |
| Return     |     | `[T,T,T,F,F]`         | `dfs(0)` returns. `count` becomes 1. |
| `countCC()`| -   | `[T,T,T,F,F]`         | `i=1`, `visited[1]` is true. Skip. |
| `countCC()`| -   | `[T,T,T,F,F]`         | `i=2`, `visited[2]` is true. Skip. |
| `countCC()`| -   | `[T,T,T,F,F]`         | `i=3`, `!visited[3]` is true. `count=1` |
| `dfs(3)`   | 3   | `[T,T,T,T,F]`         | Mark 3 visited. Neighbors of 3: {4} |
| `dfs(4)`   | 4   | `[T,T,T,T,T]`         | Mark 4 visited. Neighbors of 4: {3} |
| `dfs(3)`   | 3   | `[T,T,T,T,T]`         | 3 already visited. Return. |
| Return     |     | `[T,T,T,T,T]`         | `dfs(4)` returns. |
| Return     |     | `[T,T,T,T,T]`         | `dfs(3)` returns. `count` becomes 2. |
| `countCC()`| -   | `[T,T,T,T,T]`         | `i=4`, `visited[4]` is true. Skip. |

**Result:** `2` connected components.

## Reusable Template for DFS

```java
import java.util.ArrayList;
import java.util.List;
import java.util.Stack;

class DFSTemplate {

    // --- Tree Node Definition ---
    static class TreeNode {
        int val;
        TreeNode left;
        TreeNode right;
        TreeNode(int val) { this.val = val; }
    }

    // --- Graph Node Definition (for adjacency list) ---
    // Assuming graph nodes are 0-indexed integers

    // Recursive DFS for Tree (Pre-order traversal example)
    public List<Integer> preorderTraversalRecursive(TreeNode root) {
        List<Integer> result = new ArrayList<>();
        _dfsTreeRecursive(root, result);
        return result;
    }

    private void _dfsTreeRecursive(TreeNode node, List<Integer> result) {
        if (node == null) {
            return;
        }
        result.add(node.val);
        _dfsTreeRecursive(node.left, result);
        _dfsTreeRecursive(node.right, result);
    }

    // Iterative DFS for Tree (Pre-order traversal example)
    public List<Integer> preorderTraversalIterative(TreeNode root) {
        List<Integer> result = new ArrayList<>();
        if (root == null) {
            return result;
        }
        Stack<TreeNode> stack = new Stack<>();
        stack.push(root);
        while (!stack.isEmpty()) {
            TreeNode node = stack.pop();
            result.add(node.val);
            if (node.right != null) stack.push(node.right);
            if (node.left != null) stack.push(node.left);
        }
        return result;
    }

    // Recursive DFS for Graph
    public void dfsGraphRecursive(int startNode, List<List<Integer>> adj, boolean[] visited) {
        visited[startNode] = true;
        // Process node (e.g., print, add to list)
        // System.out.print(startNode + " ");

        for (int neighbor : adj.get(startNode)) {
            if (!visited[neighbor]) {
                dfsGraphRecursive(neighbor, adj, visited);
            }
        }
    }

    // Iterative DFS for Graph
    public void dfsGraphIterative(int startNode, List<List<Integer>> adj, boolean[] visited) {
        Stack<Integer> stack = new Stack<>();
        stack.push(startNode);
        visited[startNode] = true; // Mark as visited when pushed

        while (!stack.isEmpty()) {
            int current = stack.pop();
            // Process node (e.g., print, add to list)
            // System.out.print(current + " ");

            for (int neighbor : adj.get(current)) {
                if (!visited[neighbor]) {
                    visited[neighbor] = true; // Mark as visited when pushed
                    stack.push(neighbor);
                }
            }
        }
    }
}
```

## How to Recognize DFS in Interviews

Look for these clues:

*   **Data Structure**: Trees or Graphs.
*   **Goal**: Explore all nodes, find a path, check connectivity, detect cycles, or solve problems that involve exploring one branch completely before moving to another.
*   **Keywords**: "Traverse", "explore", "path", "connected components", "cycle detection", "topological sort", "backtracking", "pre-order", "in-order", "post-order".
*   **Constraint**: Often when `O(h)` or `O(V)` space for the stack is acceptable.

## Common Mistakes

### Mistake 1: Not Handling Visited Nodes in Graphs

Forgetting to use a `visited` set/array in graphs can lead to infinite loops if cycles are present, or redundant computations.

### Mistake 2: Incorrect Traversal Order for Trees

Mixing up pre-order, in-order, and post-order logic. Remember the position of processing the `node` relative to its `left` and `right` children.

### Mistake 3: Stack Overflow with Deep Recursion

For very deep trees or graphs, a recursive DFS can lead to a `StackOverflowError`. In such cases, an iterative DFS with an explicit `Stack` is preferred.

### Mistake 4: Not Handling Disconnected Graphs

For graphs, if you only start DFS from one node, you might not visit all nodes if the graph is disconnected. You need to iterate through all nodes and start DFS from unvisited ones to cover all components.

## DFS vs. BFS

| Feature           | DFS (Depth First Search)      | BFS (Breadth First Search)    |
|-------------------|-------------------------------|-------------------------------|
| **Traversal Order** | Explores as far as possible along each branch before backtracking. | Explores all neighbors at the current depth before moving to the next depth level. |
| **Data Structure**| Stack (explicit or recursion call stack) | Queue                         |
| **Applications**  | Pathfinding, cycle detection, topological sort, connected components, backtracking, tree traversals (pre/in/post-order). | Shortest path in unweighted graphs, finding all nodes at a certain depth, network broadcasting, web crawlers. |
| **Time Complexity** | `O(V + E)` for graphs, `O(N)` for trees. | `O(V + E)` for graphs, `O(N)` for trees. |
| **Space Complexity**| `O(V)` or `O(h)` (height) for recursion stack/explicit stack. | `O(V)` for queue (stores nodes at current level). |

## Practice Problems for This Pattern

1.  **Binary Tree Preorder Traversal** (LeetCode 144) - Classic tree DFS.
2.  **Number of Islands** (LeetCode 200) - Graph DFS application to find connected components.
3.  **Flood Fill** (LeetCode 733) - Graph DFS application.
4.  **Clone Graph** (LeetCode 133) - Graph DFS application for copying.
5.  **Path Sum** (LeetCode 112) - Tree DFS application to find a path with a specific sum.

## Interview Script You Can Reuse

```text
"This problem involves exploring all nodes in a tree/graph, which suggests a traversal algorithm like DFS. I'll use a recursive DFS approach (or iterative with an explicit stack to avoid stack overflow for deep structures). I'll start at a given node, mark it as visited, and then recursively visit all its unvisited neighbors. For graphs, it's crucial to maintain a `visited` set/array to prevent infinite loops in cycles and ensure each node is processed once. This approach guarantees an O(V + E) time complexity for graphs (or O(N) for trees) and O(V) (or O(h) for trees) space complexity for the recursion/explicit stack."
```

## Final Takeaways

*   **DFS** explores **deeply** into a branch before backtracking.
*   Can be implemented **recursively** (implicit stack) or **iteratively** (explicit stack).
*   Essential for **tree traversals** (pre-order, in-order, post-order).
*   Crucial for **graph problems** like pathfinding, cycle detection, and connected components.
*   Requires careful handling of **visited nodes** in graphs.

Mastering DFS is fundamental for solving a wide range of tree and graph problems efficiently.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
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
