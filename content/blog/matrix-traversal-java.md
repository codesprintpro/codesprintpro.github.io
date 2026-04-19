---
title: "Matrix Traversal in Java: Spiral, Diagonal, and Flood Fill"
description: "Master various matrix traversal techniques in Java, including spiral order, diagonal traversal, and flood fill. Learn their intuition, implementation, dry runs, and complexity analysis for solving common grid-based problems."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "matrix", "grid", "traversal", "spiral order", "diagonal traversal", "flood fill", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to Matrix Traversal

Matrices (or 2D arrays) are fundamental data structures used to represent grids, images, game boards, and various other tabular data. **Matrix traversal** refers to the process of visiting each element in a matrix in a specific order. While a simple row-by-row or column-by-column traversal is straightforward, many problems require more complex patterns, such as spiral, diagonal, or flood fill traversals.

Mastering these techniques is crucial for solving a wide array of algorithmic problems involving grids, from image processing to game development.

## When Should You Think About Matrix Traversal?

Consider using specific matrix traversal patterns when:

*   The problem involves a **2D grid or array**.
*   You need to visit elements in a **non-standard order** (e.g., not just row by row).
*   You need to process elements based on their **spatial relationship** (e.g., neighbors, connected components).
*   Problems involve **image processing**, **game boards**, **pathfinding**, or **connected regions**.

## Core Concepts of Matrix Traversal

We will explore three common and important matrix traversal patterns:

1.  **Spiral Order Traversal**: Visiting elements in a clockwise or counter-clockwise spiral path.
2.  **Diagonal Traversal**: Visiting elements along diagonals.
3.  **Flood Fill**: Changing the color/value of a connected region of pixels/cells.

### 1. Spiral Order Traversal

This pattern involves traversing the matrix in a spiral fashion, typically starting from the outermost layer and moving inwards. It requires careful management of boundaries.

#### Example: Spiral Matrix

Given an `m x n` matrix, return all elements of the matrix in spiral order.

```java
import java.util.ArrayList;
import java.util.List;

class Solution {
    public List<Integer> spiralOrder(int[][] matrix) {
        List<Integer> result = new ArrayList<>();
        if (matrix == null || matrix.length == 0 || matrix[0].length == 0) {
            return result;
        }

        int m = matrix.length;
        int n = matrix[0].length;

        int top = 0, bottom = m - 1;
        int left = 0, right = n - 1;

        while (top <= bottom && left <= right) {
            // Traverse right
            for (int j = left; j <= right; j++) {
                result.add(matrix[top][j]);
            }
            top++;

            // Traverse down
            for (int i = top; i <= bottom; i++) {
                result.add(matrix[i][right]);
            }
            right--;

            // Traverse left (if still valid row)
            if (top <= bottom) {
                for (int j = right; j >= left; j--) {
                    result.add(matrix[bottom][j]);
                }
                bottom--;
            }

            // Traverse up (if still valid column)
            if (left <= right) {
                for (int i = bottom; i >= top; i--) {
                    result.add(matrix[i][left]);
                }
                left++;
            }
        }
        return result;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(m * n)`, where `m` is the number of rows and `n` is the number of columns. Each element is visited exactly once.
*   **Space Complexity**: `O(1)` (excluding the result list).

### Dry Run: Spiral Matrix

**Input:** `matrix = [[1,2,3],[4,5,6],[7,8,9]]`

| Step | `top` | `bottom` | `left` | `right` | `result` |
|------|-------|----------|--------|---------|----------|
| Init | 0     | 2        | 0      | 2       | `[]`     |
| 1    | 1     | 2        | 0      | 2       | `[1,2,3]` (Right) |
| 2    | 1     | 2        | 1      | 2       | `[1,2,3,6,9]` (Down) |
| 3    | 1     | 1        | 1      | 1       | `[1,2,3,6,9,8,7]` (Left) |
| 4    | 1     | 1        | 2      | 1       | `[1,2,3,6,9,8,7,4]` (Up) |
| End  | 2     | 1        | 2      | 1       | `[1,2,3,6,9,8,7,4,5]` (Inner element) |

**Result:** `[1,2,3,6,9,8,7,4,5]`

### 2. Diagonal Traversal

Diagonal traversal involves visiting elements along diagonals. This can be tricky as the direction changes and boundaries need careful handling.

#### Example: Diagonal Traverse

Given an `m x n` matrix `mat`, return all elements of the matrix in a diagonal order.

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

class Solution {
    public int[] findDiagonalOrder(int[][] mat) {
        if (mat == null || mat.length == 0) {
            return new int[0];
        }

        int m = mat.length;
        int n = mat[0].length;
        int[] result = new int[m * n];
        int k = 0;

        // Store elements by sum of indices (i + j)
        // Each sum represents a diagonal
        List<List<Integer>> diagonals = new ArrayList<>();
        for (int i = 0; i < m + n - 1; i++) {
            diagonals.add(new ArrayList<>());
        }

        for (int i = 0; i < m; i++) {
            for (int j = 0; j < n; j++) {
                diagonals.get(i + j).add(mat[i][j]);
            }
        }

        // Iterate through diagonals and add to result
        for (int i = 0; i < m + n - 1; i++) {
            List<Integer> currentDiagonal = diagonals.get(i);
            // Even sum diagonals are traversed upwards (bottom-left to top-right)
            // Odd sum diagonals are traversed downwards (top-right to bottom-left)
            if (i % 2 == 0) {
                Collections.reverse(currentDiagonal);
            }
            for (int val : currentDiagonal) {
                result[k++] = val;
            }
        }
        return result;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(m * n)`, as each element is visited and processed once.
*   **Space Complexity**: `O(m * n)` to store the diagonals in lists.

### Dry Run: Diagonal Traverse

**Input:** `mat = [[1,2,3],[4,5,6],[7,8,9]]`

| `i+j` | Elements                               |
|-------|----------------------------------------|
| 0     | `[1]`                                  |
| 1     | `[2,4]`                                |
| 2     | `[3,5,7]`                              |
| 3     | `[6,8]`                                |
| 4     | `[9]`                                  |

**Traversal:**

*   `i+j=0` (even): `[1]` (reversed: `[1]`) -> `result = [1]`
*   `i+j=1` (odd): `[2,4]` (not reversed) -> `result = [1,2,4]`
*   `i+j=2` (even): `[3,5,7]` (reversed: `[7,5,3]`) -> `result = [1,2,4,7,5,3]`
*   `i+j=3` (odd): `[6,8]` (not reversed) -> `result = [1,2,4,7,5,3,6,8]`
*   `i+j=4` (even): `[9]` (reversed: `[9]`) -> `result = [1,2,4,7,5,3,6,8,9]`

**Result:** `[1,2,4,7,5,3,6,8,9]`

### 3. Flood Fill

Flood fill is an algorithm that determines the area connected to a given node in a multi-dimensional array. It is commonly used in image editing tools to fill connected regions with a new color.

#### Example: Flood Fill

An image is represented by an `m x n` integer grid `image` where `image[i][j]` represents the pixel value of the image. You are also given three integers `sr`, `sc`, and `color`. Perform a flood fill on the image starting from the pixel `image[sr][sc]`.

To perform a flood fill, consider the starting pixel, plus any pixels connected 4-directionally to the starting pixel of the same color as the starting pixel, plus any pixels connected 4-directionally to those pixels (also with the same color), and so on. Replace the color of all of the aforementioned pixels with `color`.

```java
class Solution {
    public int[][] floodFill(int[][] image, int sr, int sc, int color) {
        if (image[sr][sc] == color) {
            return image; // Already the target color, no need to fill
        }

        int originalColor = image[sr][sc];
        dfs(image, sr, sc, originalColor, color);
        return image;
    }

    private void dfs(int[][] image, int r, int c, int originalColor, int newColor) {
        // Base cases for DFS
        if (r < 0 || r >= image.length || c < 0 || c >= image[0].length || image[r][c] != originalColor) {
            return;
        }

        image[r][c] = newColor; // Change color of current pixel

        // Recursively call DFS for 4-directional neighbors
        dfs(image, r + 1, c, originalColor, newColor);
        dfs(image, r - 1, c, originalColor, newColor);
        dfs(image, r, c + 1, originalColor, newColor);
        dfs(image, r, c - 1, originalColor, newColor);
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(m * n)`, where `m` is the number of rows and `n` is the number of columns. In the worst case, every pixel might be visited once.
*   **Space Complexity**: `O(m * n)` in the worst case for the recursion stack (if the entire image is the same color and connected).

### Dry Run: Flood Fill

**Input:** `image = [[1,1,1],[1,1,0],[1,0,1]]`, `sr = 1`, `sc = 1`, `color = 2`

`originalColor = image[1][1] = 1`

| Call Stack (DFS) | `image` state (relevant part) |
|------------------|-------------------------------|
| `dfs(image, 1, 1, 1, 2)` | `[[1,1,1],[1,**2**,0],[1,0,1]]` |
| `dfs(image, 2, 1, 1, 2)` | `[[1,1,1],[1,2,0],[1,**2**,1]]` |
| `dfs(image, 1, 0, 1, 2)` | `[[1,1,1],[**2**,2,0],[1,2,1]]` |
| `dfs(image, 0, 0, 1, 2)` | `[[**2**,1,1],[2,2,0],[1,2,1]]` |
| `dfs(image, 0, 1, 1, 2)` | `[[2,**2**,1],[2,2,0],[1,2,1]]` |
| `dfs(image, 0, 2, 1, 2)` | `[[2,2,**2**],[2,2,0],[1,2,1]]` |

... and so on, until all connected pixels with `originalColor` are changed to `newColor`.

**Final `image`:** `[[2,2,2],[2,2,0],[2,0,1]]`

## Reusable Template for Matrix Traversal

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedList;
import java.util.List;
import java.util.Queue;

class MatrixTraversalTemplates {

    // --- Spiral Order Traversal ---
    public List<Integer> spiralOrder(int[][] matrix) {
        List<Integer> result = new ArrayList<>();
        if (matrix == null || matrix.length == 0 || matrix[0].length == 0) {
            return result;
        }

        int m = matrix.length;
        int n = matrix[0].length;

        int top = 0, bottom = m - 1;
        int left = 0, right = n - 1;

        while (top <= bottom && left <= right) {
            for (int j = left; j <= right; j++) { result.add(matrix[top][j]); }
            top++;

            for (int i = top; i <= bottom; i++) { result.add(matrix[i][right]); }
            right--;

            if (top <= bottom) {
                for (int j = right; j >= left; j--) { result.add(matrix[bottom][j]); }
                bottom--;
            }

            if (left <= right) {
                for (int i = bottom; i >= top; i--) { result.add(matrix[i][left]); }
                left++;
            }
        }
        return result;
    }

    // --- Diagonal Traversal ---
    public int[] findDiagonalOrder(int[][] mat) {
        if (mat == null || mat.length == 0) {
            return new int[0];
        }

        int m = mat.length;
        int n = mat[0].length;
        int[] result = new int[m * n];
        int k = 0;

        List<List<Integer>> diagonals = new ArrayList<>();
        for (int i = 0; i < m + n - 1; i++) {
            diagonals.add(new ArrayList<>());
        }

        for (int i = 0; i < m; i++) {
            for (int j = 0; j < n; j++) {
                diagonals.get(i + j).add(mat[i][j]);
            }
        }

        for (int i = 0; i < m + n - 1; i++) {
            List<Integer> currentDiagonal = diagonals.get(i);
            if (i % 2 == 0) {
                Collections.reverse(currentDiagonal);
            }
            for (int val : currentDiagonal) {
                result[k++] = val;
            }
        }
        return result;
    }

    // --- Flood Fill (DFS-based) ---
    public int[][] floodFill(int[][] image, int sr, int sc, int color) {
        if (image[sr][sc] == color) {
            return image;
        }
        int originalColor = image[sr][sc];
        dfsFloodFill(image, sr, sc, originalColor, color);
        return image;
    }

    private void dfsFloodFill(int[][] image, int r, int c, int originalColor, int newColor) {
        if (r < 0 || r >= image.length || c < 0 || c >= image[0].length || image[r][c] != originalColor) {
            return;
        }
        image[r][c] = newColor;
        dfsFloodFill(image, r + 1, c, originalColor, newColor);
        dfsFloodFill(image, r - 1, c, originalColor, newColor);
        dfsFloodFill(image, r, c + 1, originalColor, newColor);
        dfsFloodFill(image, r, c - 1, originalColor, newColor);
    }

    // --- Flood Fill (BFS-based) ---
    public int[][] floodFillBFS(int[][] image, int sr, int sc, int color) {
        if (image[sr][sc] == color) {
            return image;
        }

        int m = image.length;
        int n = image[0].length;
        int originalColor = image[sr][sc];

        Queue<int[]> queue = new LinkedList<>();
        queue.offer(new int[]{sr, sc});
        image[sr][sc] = color;

        int[][] directions = {{0, 1}, {0, -1}, {1, 0}, {-1, 0}}; // Right, Left, Down, Up

        while (!queue.isEmpty()) {
            int[] current = queue.poll();
            int r = current[0];
            int c = current[1];

            for (int[] dir : directions) {
                int nr = r + dir[0];
                int nc = c + dir[1];

                if (nr >= 0 && nr < m && nc >= 0 && nc < n && image[nr][nc] == originalColor) {
                    image[nr][nc] = color;
                    queue.offer(new int[]{nr, nc});
                }
            }
        }
        return image;
    }
}
```

## How to Recognize Matrix Traversal in Interviews

Look for these clues:

*   **Data Structure**: 2D array, grid, matrix, board.
*   **Goal**: Visit all elements, find a path, count connected components, or modify regions.
*   **Keywords**: "Spiral order", "diagonal traversal", "flood fill", "connected cells", "island problems", "game board", "image processing".
*   **Constraints**: Often involves boundary checks and managing visited states.

## Common Mistakes

### Mistake 1: Incorrect Boundary Conditions

Off-by-one errors in loop conditions (`top <= bottom`, `left <= right`) or array access can lead to infinite loops or `ArrayIndexOutOfBoundsException`.

### Mistake 2: Not Handling Edge Cases (Empty/Single-Element Matrix)

Always check for `null` or empty matrices at the beginning of your function to prevent errors.

### Mistake 3: Redundant Traversal in Flood Fill

In recursive Flood Fill (DFS), ensure the base case `image[r][c] != originalColor` is checked *before* changing the color to prevent infinite recursion if the pixel is already the new color.

### Mistake 4: Incorrect Directional Logic

For spiral or diagonal traversals, ensure the direction changes are correctly implemented and that the boundaries are updated appropriately after each segment of traversal.

## Matrix Traversal vs. Other Graph Algorithms

While matrices can be viewed as graphs (where each cell is a node and adjacent cells are connected by edges), specific traversal patterns are often more efficient than general graph algorithms for grid-based problems.

*   **BFS/DFS**: Can be used for matrix traversal (e.g., Flood Fill is essentially BFS/DFS on a grid). However, for structured traversals like spiral or diagonal, direct iterative approaches are often simpler and more performant.
*   **Dijkstra/A***: For finding shortest paths in weighted grids (e.g., maze with varying costs), these algorithms are more appropriate.

## Practice Problems for This Pattern

1.  **Spiral Matrix** (LeetCode 54) - Classic spiral traversal.
2.  **Spiral Matrix II** (LeetCode 59) - Generate a spiral matrix.
3.  **Diagonal Traverse** (LeetCode 498) - Traverse matrix diagonally.
4.  **Flood Fill** (LeetCode 733) - Change color of connected components.
5.  **Number of Islands** (LeetCode 200) - Count connected components (can use DFS/BFS on grid).
6.  **Rotting Oranges** (LeetCode 994) - Multi-source BFS on a grid.

## Interview Script You Can Reuse

```text
"This problem involves traversing a 2D matrix in a specific pattern. For spiral traversal, I'll use four pointers (top, bottom, left, right) to define the current boundaries and iteratively shrink them as I traverse each layer. For diagonal traversal, I can group elements by the sum of their indices (i+j), as elements on the same diagonal share the same sum. For flood fill, I'll use a recursive DFS approach (or an iterative BFS with a queue) to visit all 4-directionally connected cells of the same original color and change them to the new color. In all cases, careful boundary checks are essential. The time complexity for these traversals will generally be O(m*n) as each cell is visited once, and space complexity will be O(1) for spiral/flood fill (excluding recursion stack) or O(m*n) for diagonal traversal if storing diagonals."
```

## Final Takeaways

*   **Matrix traversal** involves visiting elements in a 2D array in a defined order.
*   **Spiral order** uses boundary pointers to move inwards.
*   **Diagonal traversal** often groups elements by `row + col` sum.
*   **Flood Fill** uses DFS or BFS to color connected regions.
*   Crucial for **grid-based problems**, **image processing**, and **game development**.
*   Pay close attention to **boundary conditions** and **edge cases**.

Mastering these matrix traversal techniques provides a strong foundation for solving complex grid-related algorithms.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
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
