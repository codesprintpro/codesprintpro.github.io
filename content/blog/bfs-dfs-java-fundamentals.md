---
title: "BFS and DFS in Java: A Guide to Tree and Graph Traversals"
description: "Master Breadth-First Search (BFS) and Depth-First Search (DFS) in Java. Learn the recursive and iterative templates for traversing trees and graphs with clear code examples."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "bfs", "dfs", "graphs", "trees", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

Search and traversal are the foundation of almost every graph or tree problem you will encounter in a technical interview. Whether you are finding the shortest path or checking for connectivity, you will likely use either **BFS** or **DFS**.

In Java, these algorithms follow very consistent templates. Once you memorize the structure, you can solve dozens of different problems by just tweaking a few lines of logic.

## Depth-First Search (DFS)

DFS explores as far as possible along each branch before backtracking. It is naturally **recursive**, but can also be implemented iteratively using a **Stack**.

### Use Cases for DFS:
- Pathfinding (finding *any* path)
- Topological sort
- Cycle detection
- Solving puzzles like Mazes or Sudoku

### DFS Template (Recursive)

```java
public void dfs(Node node, Set<Node> visited) {
    if (node == null || visited.contains(node)) return;

    // 1. Mark as visited
    visited.add(node);
    System.out.println("Visited: " + node.val);

    // 2. Explore neighbors
    for (Node neighbor : node.neighbors) {
        dfs(neighbor, visited);
    }
}
```

---

## Breadth-First Search (BFS)

BFS explores all neighbors at the current depth before moving to the next level. It is implemented iteratively using a **Queue**.

### Use Cases for BFS:
- **Shortest Path** in an unweighted graph
- Level-order traversal of a tree
- Finding the "minimum number of steps" to reach a target

### BFS Template (Iterative)

```java
import java.util.*;

public void bfs(Node startNode) {
    Queue<Node> queue = new LinkedList<>();
    Set<Node> visited = new HashSet<>();

    queue.add(startNode);
    visited.add(startNode);

    while (!queue.isEmpty()) {
        Node current = queue.poll();
        System.out.println("Visited: " + current.val);

        for (Node neighbor : current.neighbors) {
            if (!visited.contains(neighbor)) {
                visited.add(neighbor);
                queue.add(neighbor);
            }
        }
    }
}
```

---

## Key Differences

| Feature | DFS | BFS |
|---|---|---|
| **Data Structure** | Stack (or Recursion) | Queue |
| **Pathfinding** | Finds *any* path | Finds *shortest* path |
| **Memory** | Efficient for deep trees | High for wide trees |
| **Approach** | Go deep first | Go wide first |

## BFS/DFS in a Grid (Matrix)

A common interview variation is traversing a 2D grid. Instead of an adjacency list, your "neighbors" are the cells above, below, left, and right.

```java
int[][] directions = {{0, 1}, {0, -1}, {1, 0}, {-1, 0}};

public void traverseGrid(int[][] grid, int r, int c, boolean[][] visited) {
    int rows = grid.length;
    int cols = grid[0].length;

    if (r < 0 || r >= rows || c < 0 || c >= cols || visited[r][c]) return;

    visited[r][c] = true;

    for (int[] dir : directions) {
        traverseGrid(grid, r + dir[0], c + dir[1], visited);
    }
}
```

## Summary

The choice between BFS and DFS depends on what you are looking for. If you need the **shortest path**, BFS is your best bet. If you need to explore **all possibilities** or find a path through a complex maze, DFS is usually easier to implement. Both have a time complexity of $O(V + E)$, where $V$ is vertices and $E$ is edges.
