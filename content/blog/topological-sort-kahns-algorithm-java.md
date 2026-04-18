---
title: "Topological Sort in Java: Handling Dependencies with Kahn's Algorithm"
description: "Master Topological Sort in Java using Kahn's Algorithm for ordering tasks with dependencies. Learn its intuition, implementation, dry runs, and complexity analysis for various scheduling and dependency problems."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "topological sort", "kahn's algorithm", "graph", "dag", "dependency resolution", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to Topological Sort

**Topological Sort** (or Topological Ordering) is an algorithm for ordering the vertices of a **Directed Acyclic Graph (DAG)** such that for every directed edge `u -> v`, vertex `u` comes before vertex `v` in the ordering. It's like creating a valid sequence of tasks where some tasks must be completed before others. If a graph contains a cycle, a topological sort is not possible.

This pattern is crucial for problems involving task scheduling, dependency resolution (e.g., build systems, course prerequisites), and instruction ordering.

## When Should You Think About Topological Sort?

Consider using Topological Sort when:

*   You are given a **Directed Acyclic Graph (DAG)**.
*   You need to find a **linear ordering of vertices**.
*   The problem involves **dependencies** or **prerequisites** (e.g., task scheduling, course prerequisites, build order).
*   You need to detect if a directed graph contains a **cycle** (if a topological sort cannot be performed, a cycle exists).

## Core Concept of Topological Sort (Kahn's Algorithm)

There are two main algorithms for topological sorting: Kahn's Algorithm (using BFS) and one based on DFS. This article focuses on **Kahn's Algorithm**, which uses the concept of **in-degrees** (the number of incoming edges to a vertex).

Kahn's Algorithm works as follows:

1.  **Calculate In-degrees**: For each vertex, compute its in-degree.
2.  **Initialize Queue**: Add all vertices with an in-degree of `0` to a queue. These are the tasks that have no prerequisites.
3.  **Process Queue**: While the queue is not empty:
    a.  Dequeue a vertex `u` and add it to the topological order.
    b.  For each neighbor `v` of `u`:
        i.  Decrement the in-degree of `v`.
        ii. If `v`'s in-degree becomes `0`, enqueue `v`.
4.  **Check for Cycle**: If the number of vertices in the topological order is less than the total number of vertices in the graph, then the graph contains a cycle and a topological sort is not possible.

## Example: Course Schedule

There are a total of `numCourses` courses you have to take, labeled from `0` to `numCourses - 1`. You are given an array `prerequisites` where `prerequisites[i] = [ai, bi]` indicates that you must take course `bi` first if you want to take course `ai`. Return the ordering of courses you should take to finish all courses. If there are many valid answers, return any of them. If it is impossible to finish all courses, return an empty array.

#### Brute Force Approach (Conceptual)

A brute-force approach might involve trying all permutations of courses and checking if they satisfy all prerequisites. This would be computationally infeasible for even a small number of courses.

#### Optimized with Kahn's Algorithm

```java
import java.util.ArrayList;
import java.util.LinkedList;
import java.util.List;
import java.util.Queue;

class Solution {
    public int[] findOrder(int numCourses, int[][] prerequisites) {
        // 1. Initialize adjacency list and in-degree array
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < numCourses; i++) {
            adj.add(new ArrayList<>());
        }

        int[] inDegree = new int[numCourses];

        // Build graph and calculate in-degrees
        for (int[] prerequisite : prerequisites) {
            int course = prerequisite[0];
            int pre = prerequisite[1];
            adj.get(pre).add(course); // Edge from pre to course
            inDegree[course]++;
        }

        // 2. Initialize queue with courses having in-degree 0
        Queue<Integer> queue = new LinkedList<>();
        for (int i = 0; i < numCourses; i++) {
            if (inDegree[i] == 0) {
                queue.offer(i);
            }
        }

        // 3. Process queue
        int[] topologicalOrder = new int[numCourses];
        int count = 0;

        while (!queue.isEmpty()) {
            int course = queue.poll();
            topologicalOrder[count++] = course;

            for (int neighbor : adj.get(course)) {
                inDegree[neighbor]--;
                if (inDegree[neighbor] == 0) {
                    queue.offer(neighbor);
                }
            }
        }

        // 4. Check for cycle
        if (count == numCourses) {
            return topologicalOrder;
        } else {
            return new int[0]; // Cycle detected, impossible to finish all courses
        }
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(V + E)`, where `V` is the number of courses (vertices) and `E` is the number of prerequisites (edges). Each vertex and edge is processed a constant number of times.
*   **Space Complexity**: `O(V + E)` for the adjacency list, in-degree array, and queue.

### Dry Run: Course Schedule

**Input:** `numCourses = 4`, `prerequisites = [[1,0], [2,0], [3,1], [3,2]]`

This means:
*   To take 1, must take 0.
*   To take 2, must take 0.
*   To take 3, must take 1.
*   To take 3, must take 2.

Graph:
```
0 --> 1 --> 3
 \   /
  --> 2 --/
```

1.  **Initialize**: `adj = [[1,2], [3], [3], []]`, `inDegree = [0, 1, 1, 2]`
2.  **Queue**: `queue = [0]` (only course 0 has in-degree 0)
3.  **Process Queue**:

| Step | Dequeued `course` | `topologicalOrder` | `inDegree` (after update) | `queue` (after update) |
|------|-------------------|--------------------|---------------------------|------------------------|
| 1    | 0                 | [0]                | `inDegree[1]` becomes 0, `inDegree[2]` becomes 0 | [1, 2]                 |
| 2    | 1                 | [0, 1]             | `inDegree[3]` becomes 1   | [2]                    |
| 3    | 2                 | [0, 1, 2]          | `inDegree[3]` becomes 0   | [3]                    |
| 4    | 3                 | [0, 1, 2, 3]       | -                         | []                     |

4.  **Check for Cycle**: `count = 4`, `numCourses = 4`. `count == numCourses` is true.

**Result:** `[0, 1, 2, 3]` (or `[0, 2, 1, 3]`, both are valid)

## Reusable Template for Kahn's Algorithm

```java
import java.util.ArrayList;
import java.util.LinkedList;
import java.util.List;
import java.util.Queue;

class TopologicalSortKahn {

    /**
     * Performs topological sort on a Directed Acyclic Graph (DAG) using Kahn's Algorithm.
     * @param numVertices The total number of vertices in the graph.
     * @param edges A list of directed edges, where each edge[0] -> edge[1].
     * @return A list representing a valid topological order, or an empty list if a cycle is detected.
     */
    public List<Integer> topologicalSort(int numVertices, int[][] edges) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < numVertices; i++) {
            adj.add(new ArrayList<>());
        }

        int[] inDegree = new int[numVertices];

        // Build graph and calculate in-degrees
        for (int[] edge : edges) {
            int u = edge[0]; // from
            int v = edge[1]; // to
            adj.get(u).add(v);
            inDegree[v]++;
        }

        Queue<Integer> queue = new LinkedList<>();
        for (int i = 0; i < numVertices; i++) {
            if (inDegree[i] == 0) {
                queue.offer(i);
            }
        }

        List<Integer> result = new ArrayList<>();
        int visitedCount = 0;

        while (!queue.isEmpty()) {
            int u = queue.poll();
            result.add(u);
            visitedCount++;

            for (int v : adj.get(u)) {
                inDegree[v]--;
                if (inDegree[v] == 0) {
                    queue.offer(v);
                }
            }
        }

        // If visitedCount is less than numVertices, a cycle exists
        if (visitedCount == numVertices) {
            return result;
        } else {
            return new ArrayList<>(); // Return empty list to indicate cycle
        }
    }
}
```

## How to Recognize Topological Sort in Interviews

Look for these clues:

*   **Data Structure**: Directed Graph.
*   **Constraint**: The graph must be **Acyclic** (DAG). If a cycle is present, topological sort is impossible.
*   **Goal**: Find a **linear ordering** of elements.
*   **Keywords**: "Dependencies", "prerequisites", "build order", "task scheduling", "course schedule", "order of execution".

## Common Mistakes

### Mistake 1: Not Handling Cycles

Forgetting to check if `visitedCount == numVertices` at the end. If not all vertices can be added to the topological order, it means there's a cycle, and no valid topological sort exists.

### Mistake 2: Incorrectly Calculating In-degrees

Ensure that the in-degree for each vertex is correctly calculated based on the direction of edges. An edge `u -> v` means `v`'s in-degree increases.

### Mistake 3: Using DFS for Cycle Detection in DAGs

While DFS can also perform topological sort and detect cycles, Kahn's algorithm (BFS-based) is often more intuitive for dependency problems as it naturally processes nodes with no incoming dependencies first.

### Mistake 4: Not Handling Disconnected Components

Kahn's algorithm naturally handles disconnected components by adding all nodes with in-degree 0 to the initial queue. However, ensure your graph representation correctly accounts for all vertices, even isolated ones.

## Topological Sort vs. Other Graph Traversals

*   **Topological Sort**: Specific to DAGs, provides a linear ordering respecting dependencies. Uses in-degrees (Kahn's) or DFS finish times.
*   **BFS**: Explores level by level, good for shortest paths in unweighted graphs. Does not inherently provide a topological order.
*   **DFS**: Explores deeply, good for pathfinding, cycle detection, and connected components. Can also be used for topological sort by ordering nodes by their finish times.

## Practice Problems for This Pattern

1.  **Course Schedule** (LeetCode 207) - Determine if a valid course order exists.
2.  **Course Schedule II** (LeetCode 210) - Return one valid course order.
3.  **Alien Dictionary** (LeetCode 269) - Construct a topological order from a list of words.
4.  **Minimum Height Trees** (LeetCode 310) - Can involve concepts related to removing leaves (nodes with in-degree 1 in a tree context) which is similar to Kahn's.

## Interview Script You Can Reuse

```text
"This problem involves tasks with dependencies, which is a classic application for Topological Sort on a Directed Acyclic Graph (DAG). I'll use Kahn's Algorithm, which is a BFS-based approach. First, I'll build an adjacency list to represent the graph and calculate the in-degree for each course (number of prerequisites). Then, I'll add all courses with an in-degree of zero to a queue. I'll process courses from the queue, adding them to my topological order, and for each processed course, I'll decrement the in-degree of its dependent courses. If a dependent course's in-degree becomes zero, I'll add it to the queue. Finally, if the total number of courses in my topological order equals the total number of courses, a valid order exists; otherwise, a cycle is present, and it's impossible to complete all courses. This approach yields an O(V + E) time complexity and O(V + E) space complexity."
```

## Final Takeaways

*   **Topological Sort** provides a **linear ordering** for **DAGs**.
*   **Kahn's Algorithm** uses **in-degrees** and a **queue** (BFS-like).
*   Crucial for **dependency resolution** and **task scheduling**.
*   Can be used to **detect cycles** in directed graphs.
*   Achieves **`O(V + E)` time and space complexity**.

Mastering Topological Sort is essential for problems where the order of operations or tasks is constrained by dependencies.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
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
