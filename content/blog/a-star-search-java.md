---
title: "A* Search Algorithm in Java: Heuristic Pathfinding"
description: "Master the A* search algorithm in Java. Learn how it combines Dijkstra's logic with heuristics to find the shortest path significantly faster in maps and grids."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "graph", "shortest path", "a-star", "heuristic", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

The **A* (A-Star) search algorithm** is one of the most successful pathfinding algorithms in computer science. It is widely used in video games and robotics because it is both efficient and guaranteed to find the shortest path (given a proper heuristic).

It is essentially **Dijkstra's algorithm with a brain**.

## The Core Concept: $f(n) = g(n) + h(n)$

Instead of just looking at the distance from the start (like Dijkstra), A* uses a "heuristic" to estimate the distance to the goal.
- **$g(n)$**: The actual cost from the start node to the current node $n$.
- **$h(n)$**: The estimated (heuristic) cost from node $n$ to the goal.
- **$f(n)$**: The total estimated cost of the path through node $n$.

A* always expands the node with the lowest $f(n)$.

---

## A* Implementation in Java (on a Grid)

```java
import java.util.*;

public class AStarSearch {
    static class Node implements Comparable<Node> {
        int x, y, g, h, f;
        Node parent;

        Node(int x, int y) {
            this.x = x;
            this.y = y;
        }

        @Override
        public int compareTo(Node other) {
            return Integer.compare(this.f, other.f);
        }
    }

    public List<Node> findPath(int[][] grid, int[] start, int[] end) {
        PriorityQueue<Node> openList = new PriorityQueue<>();
        boolean[][] closedList = new boolean[grid.length][grid[0].length];

        Node startNode = new Node(start[0], start[1]);
        Node endNode = new Node(end[0], end[1]);

        openList.add(startNode);

        while (!openList.isEmpty()) {
            Node current = openList.poll();
            closedList[current.x][current.y] = true;

            if (current.x == endNode.x && current.y == endNode.y) {
                return reconstructPath(current);
            }

            for (Node neighbor : getNeighbors(current, grid)) {
                if (closedList[neighbor.x][neighbor.y]) continue;

                int tentativeG = current.g + 1; // Assuming cost between adjacent cells is 1

                if (tentativeG < neighbor.g || !contains(openList, neighbor)) {
                    neighbor.parent = current;
                    neighbor.g = tentativeG;
                    neighbor.h = calculateHeuristic(neighbor, endNode);
                    neighbor.f = neighbor.g + neighbor.h;

                    if (!contains(openList, neighbor)) {
                        openList.add(neighbor);
                    }
                }
            }
        }
        return null; // No path found
    }

    private int calculateHeuristic(Node a, Node b) {
        // Manhattan distance for grid-based movement
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }
}
```

---

## Dijkstra vs. A*

| Feature | Dijkstra | A* |
|---|---|---|
| **Heuristic** | None (or $h(n) = 0$) | Uses $h(n)$ to guide search |
| **Expansion** | Expands in all directions equally | Focuses towards the goal |
| **Performance** | Slower | Much faster (with a good heuristic) |
| **Optimality** | Guaranteed shortest path | Guaranteed (if $h(n)$ is admissible) |

## What is an "Admissible" Heuristic?

A heuristic is **admissible** if it never overestimates the actual cost to reach the goal. If your heuristic is too "optimistic," A* might pick a sub-optimal path. Manhattan distance (for 4-direction movement) and Euclidean distance (for any-angle movement) are classic admissible heuristics.

## Summary

A* is the gold standard for pathfinding in constrained spaces. By combining the rigorous distance tracking of Dijkstra with a smart "guess" about the remaining distance, it avoids exploring unnecessary areas of the graph. Understanding A* is a great way to show that you can apply mathematical intuition to solve practical engineering problems.
