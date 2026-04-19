---
title: "Topological Sort in Java: Managing Dependencies in Graphs"
description: "Master Topological Sort using Kahn's Algorithm and DFS in Java. Learn how to solve 'Course Schedule' and dependency resolution problems in linear time."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "graph", "topological sort", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

Topological sort is a linear ordering of vertices in a **Directed Acyclic Graph (DAG)** such that for every directed edge $u \rightarrow v$, vertex $u$ comes before $v$ in the ordering.

Think of it as a **task scheduler**. If you have to take Course A before Course B, and Course B before Course C, topological sort gives you the valid sequence: A, B, C.

## When to use Topological Sort?
- Dependency resolution (e.g., Maven or Gradle builds)
- Course scheduling
- Compiling source code files
- Job scheduling with prerequisites

---

## Kahn's Algorithm (BFS-based)

This is the most intuitive way to implement topological sort. It uses the concept of **In-degree** (the number of incoming edges to a node).

**The Logic**:
1. Calculate the in-degree of every node.
2. Add all nodes with an in-degree of 0 to a Queue.
3. While the Queue is not empty:
   - Pop a node, add it to the result.
   - For each neighbor, decrement its in-degree.
   - If a neighbor's in-degree becomes 0, add it to the Queue.
4. If the result size is less than the number of nodes, there is a cycle!

```java
import java.util.*;

public List<Integer> topologicalSort(int numNodes, int[][] edges) {
    List<Integer> result = new ArrayList<>();
    int[] inDegree = new int[numNodes];
    Map<Integer, List<Integer>> adj = new HashMap<>();

    // 1. Build Adjacency List and Calculate In-Degrees
    for (int i = 0; i < numNodes; i++) adj.put(i, new ArrayList<>());
    for (int[] edge : edges) {
        adj.get(edge[0]).add(edge[1]);
        inDegree[edge[1]]++;
    }

    // 2. Add nodes with 0 in-degree to Queue
    Queue<Integer> queue = new LinkedList<>();
    for (int i = 0; i < numNodes; i++) {
        if (inDegree[i] == 0) queue.add(i);
    }

    // 3. Process Queue
    while (!queue.isEmpty()) {
        int current = queue.poll();
        result.add(current);

        for (int neighbor : adj.get(current)) {
            inDegree[neighbor]--;
            if (inDegree[neighbor] == 0) {
                queue.add(neighbor);
            }
        }
    }

    // 4. Cycle Check
    if (result.size() != numNodes) return new ArrayList<>(); // Cycle detected
    return result;
}
```

---

## Topological Sort via DFS

You can also use DFS. The idea is to perform a DFS on each node and add it to a stack **after** its neighbors are visited. The final topological order is the stack contents from top to bottom.

```java
public void dfs(int node, Map<Integer, List<Integer>> adj, boolean[] visited, Stack<Integer> stack) {
    visited[node] = true;
    for (int neighbor : adj.get(node)) {
        if (!visited[neighbor]) {
            dfs(neighbor, adj, visited, stack);
        }
    }
    stack.push(node); // Add to stack after all dependencies are visited
}
```

## Summary Table

| Feature | Kahn's Algorithm | DFS-based |
|---|---|---|
| **Underlying Traversal** | BFS | DFS |
| **Cycle Detection** | Easy (Check result size) | Requires extra `isVisiting` state |
| **Data Structure** | Queue + In-degree array | Stack + Visited array |
| **Intuition** | Pick "ready" tasks first | Resolve "final" tasks last |

## Conclusion

Topological sort is an $O(V+E)$ algorithm that is essential for any problem involving dependencies. Kahn's algorithm is usually the preferred method in interviews because it handles cycle detection gracefully and is often easier to debug than recursive DFS.
