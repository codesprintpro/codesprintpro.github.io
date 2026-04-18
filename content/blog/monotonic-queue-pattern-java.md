---
title: "Monotonic Queue Pattern in Java: Efficiently Solving Sliding Window Maximum"
description: "Master the Monotonic Queue pattern in Java for efficiently solving sliding window maximum/minimum problems. Learn its intuition, algorithm, dry runs, and complexity analysis."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "monotonic queue", "queue", "sliding window", "deque", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to the Monotonic Queue Pattern

The **Monotonic Queue pattern**, often implemented using a `Deque` (double-ended queue), is a specialized data structure technique used to efficiently solve problems involving **sliding window maximum** or **sliding window minimum**. While the Sliding Window pattern helps reduce overall time complexity by avoiding redundant calculations, a monotonic queue further optimizes operations within the window, typically reducing the time to find the maximum or minimum element from `O(k)` (where `k` is window size) to `O(1)` amortized time.

This pattern is particularly powerful because it allows us to maintain the maximum or minimum element within a sliding window in `O(n)` total time, where `n` is the size of the array, rather than `O(n*k)` or `O(n log k)` with other approaches.

## When Should You Think About Monotonic Queue?

Consider the Monotonic Queue pattern when:

*   You are dealing with **arrays or lists**.
*   You need to find the **maximum or minimum element within every sliding window** of a fixed size `k`.
*   The problem is a variation of the **Sliding Window Maximum/Minimum** problem.
*   You need to achieve an **`O(n)` time complexity** for such problems.
*   A naive approach using a simple queue or iterating through the window would be too slow (`O(n*k)`).
*   Using a `PriorityQueue` (heap) would be `O(n log k)`, which might still be suboptimal.

## Core Concept of Monotonic Queue

A monotonic queue (or deque) stores elements in either strictly increasing or strictly decreasing order. For the sliding window maximum problem, we maintain a **monotonically decreasing queue**.

Here's how it works for finding the maximum in a sliding window:

1.  **Maintain Decreasing Order**: When adding a new element to the back of the deque, remove all elements from the back that are smaller than the new element. This ensures the deque always stores elements in decreasing order from front to back.
2.  **Front is Max**: The element at the front of the deque will always be the maximum element in the current window.
3.  **Remove Out-of-Window Elements**: Before adding a new element, check if the element at the front of the deque is outside the current window (i.e., its index is less than `windowStart`). If it is, remove it from the front.

By following these rules, the deque effectively stores only potentially maximum elements within the current window, ordered from largest to smallest.

## Example: Sliding Window Maximum

Given an array `nums` and a sliding window of size `k`, return the maximum value in each window.

#### Brute Force Approach

A naive approach would be to iterate through all possible windows and find the maximum in each window.

```java
class Solution {
    public int[] maxSlidingWindowBruteForce(int[] nums, int k) {
        if (nums == null || k <= 0 || k > nums.length) {
            return new int[0];
        }

        int n = nums.length;
        int[] result = new int[n - k + 1];
        int resultIdx = 0;

        for (int i = 0; i <= n - k; i++) {
            int currentMax = nums[i];
            for (int j = i + 1; j < i + k; j++) {
                currentMax = Math.max(currentMax, nums[j]);
            }
            result[resultIdx++] = currentMax;
        }
        return result;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n*k)`, as for each of `n-k+1` windows, we iterate `k` times to find the maximum.
*   **Space Complexity**: `O(1)` (excluding result storage).

#### Optimized with Monotonic Queue (Deque)

```java
import java.util.ArrayDeque;
import java.util.Deque;

class Solution {
    public int[] maxSlidingWindow(int[] nums, int k) {
        if (nums == null || k <= 0 || k > nums.length) {
            return new int[0];
        }

        int n = nums.length;
        int[] result = new int[n - k + 1];
        int resultIdx = 0;

        // Store indices of elements, maintaining a monotonically decreasing order of values
        Deque<Integer> deque = new ArrayDeque<>(); 

        for (int i = 0; i < n; i++) {
            // 1. Remove elements from the front that are out of the current window
            if (!deque.isEmpty() && deque.peekFirst() < i - k + 1) {
                deque.removeFirst();
            }

            // 2. Remove elements from the back that are smaller than the current element
            //    This maintains the decreasing order
            while (!deque.isEmpty() && nums[deque.peekLast()] < nums[i]) {
                deque.removeLast();
            }

            // 3. Add current element's index to the back of the deque
            deque.addLast(i);

            // 4. If window has formed, the front of the deque is the maximum for this window
            if (i >= k - 1) {
                result[resultIdx++] = nums[deque.peekFirst()];
            }
        }
        return result;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, as each element is added to and removed from the deque at most once.
*   **Space Complexity**: `O(k)`, as the deque stores at most `k` elements (indices).

### Dry Run: Sliding Window Maximum

**Input:** `nums = [1, 3, -1, -3, 5, 3, 6, 7]`, `k = 3`

| `i` | `nums[i]` | `deque` (indices, front is max) | `deque.peekFirst()` (out of window?) | `nums[deque.peekLast()] < nums[i]` | `result` array | Notes |
|-----|-----------|---------------------------------|--------------------------------------|------------------------------------|----------------|-------|
| -   | -         | []                              | -                                    | -                                  | []             | Initialize |
| 0   | 1         | [0]                             | -                                    | -                                  | []             | Add 0 |
| 1   | 3         | [1]                             | -                                    | `nums[0] (1) < nums[1] (3)` -> pop 0 | []             | Add 1 |
| 2   | -1        | [1, 2]                          | -                                    | -                                  | []             | Add 2. Window `[1,3,-1]` formed. |
|     |           |                                 |                                      |                                    | [3]            | `result[0] = nums[deque.peekFirst()] = nums[1] = 3` |
| 3   | -3        | [1, 2, 3]                       | `deque.peekFirst() (1) < 3-3+1 (1)` -> false | -                                  | [3]            | Add 3. Window `[3,-1,-3]` formed. |
|     |           |                                 |                                      |                                    | [3, 3]         | `result[1] = nums[deque.peekFirst()] = nums[1] = 3` |
| 4   | 5         | [4]                             | `deque.peekFirst() (1) < 4-3+1 (2)` -> pop 1 | `nums[3] (-3) < nums[4] (5)` -> pop 3; `nums[2] (-1) < nums[4] (5)` -> pop 2 | [3, 3]         | Add 4. Window `[-1,-3,5]` formed. |
|     |           |                                 |                                      |                                    | [3, 3, 5]      | `result[2] = nums[deque.peekFirst()] = nums[4] = 5` |
| 5   | 3         | [4, 5]                          | `deque.peekFirst() (4) < 5-3+1 (3)` -> false | `nums[4] (5) < nums[5] (3)` -> false | [3, 3, 5]      | Add 5. Window `[-3,5,3]` formed. |
|     |           |                                 |                                      |                                    | [3, 3, 5, 5]   | `result[3] = nums[deque.peekFirst()] = nums[4] = 5` |
| 6   | 6         | [6]                             | `deque.peekFirst() (4) < 6-3+1 (4)` -> pop 4 | `nums[5] (3) < nums[6] (6)` -> pop 5 | [3, 3, 5, 5]   | Add 6. Window `[5,3,6]` formed. |
|     |           |                                 |                                      |                                    | [3, 3, 5, 5, 6]| `result[4] = nums[deque.peekFirst()] = nums[6] = 6` |
| 7   | 7         | [7]                             | `deque.peekFirst() (6) < 7-3+1 (5)` -> false | `nums[6] (6) < nums[7] (7)` -> pop 6 | [3, 3, 5, 5, 6]| Add 7. Window `[3,6,7]` formed. |
|     |           |                                 |                                      |                                    | [3, 3, 5, 5, 6, 7]| `result[5] = nums[deque.peekFirst()] = nums[7] = 7` |

**Result:** `[3, 3, 5, 5, 6, 7]`

## Reusable Template for Monotonic Queue

```java
import java.util.ArrayDeque;
import java.util.Deque;

class MonotonicQueueTemplate {

    // Finds the maximum element in each sliding window of size k
    public int[] slidingWindowMaximum(int[] nums, int k) {
        if (nums == null || k <= 0 || k > nums.length) {
            return new int[0];
        }

        int n = nums.length;
        int[] result = new int[n - k + 1];
        int resultIdx = 0;

        // Deque stores indices, maintaining a monotonically decreasing order of values
        Deque<Integer> deque = new ArrayDeque<>(); 

        for (int i = 0; i < n; i++) {
            // Remove indices from the front that are outside the current window
            if (!deque.isEmpty() && deque.peekFirst() < i - k + 1) {
                deque.removeFirst();
            }

            // Remove indices from the back whose corresponding values are smaller than nums[i]
            // This ensures the deque is monotonically decreasing
            while (!deque.isEmpty() && nums[deque.peekLast()] < nums[i]) {
                deque.removeLast();
            }

            // Add current element's index to the back of the deque
            deque.addLast(i);

            // If the window has fully formed (i.e., we have processed at least k elements),
            // the element at the front of the deque is the maximum for this window.
            if (i >= k - 1) {
                result[resultIdx++] = nums[deque.peekFirst()];
            }
        }
        return result;
    }

    // For sliding window minimum, the logic is similar, but the deque would be monotonically increasing.
    public int[] slidingWindowMinimum(int[] nums, int k) {
        if (nums == null || k <= 0 || k > nums.length) {
            return new int[0];
        }

        int n = nums.length;
        int[] result = new int[n - k + 1];
        int resultIdx = 0;

        // Deque stores indices, maintaining a monotonically increasing order of values
        Deque<Integer> deque = new ArrayDeque<>(); 

        for (int i = 0; i < n; i++) {
            // Remove indices from the front that are outside the current window
            if (!deque.isEmpty() && deque.peekFirst() < i - k + 1) {
                deque.removeFirst();
            }

            // Remove indices from the back whose corresponding values are larger than nums[i]
            // This ensures the deque is monotonically increasing
            while (!deque.isEmpty() && nums[deque.peekLast()] > nums[i]) {
                deque.removeLast();
            }

            // Add current element's index to the back of the deque
            deque.addLast(i);

            // If the window has fully formed, the front of the deque is the minimum for this window.
            if (i >= k - 1) {
                result[resultIdx++] = nums[deque.peekFirst()];
            }
        }
        return result;
    }
}
```

## How to Recognize Monotonic Queue in Interviews

Look for these clues:

*   **Input**: Array or list of numbers.
*   **Goal**: Find the **maximum or minimum element within every sliding window of a fixed size `k`**.
*   **Keywords**: "Sliding window maximum", "sliding window minimum", "range maximum query (RMQ)" in a sliding window context.
*   **Efficiency**: When an `O(n)` solution is required for sliding window max/min, and `O(n log k)` (using a `PriorityQueue`) is not optimal enough.

## Common Mistakes

### Mistake 1: Incorrectly Maintaining Monotonicity

Ensure that when you add a new element, you correctly remove elements from the back of the deque that violate the monotonic property (smaller elements for max, larger elements for min).

### Mistake 2: Not Removing Out-of-Window Elements

Forgetting to remove elements from the front of the deque that are no longer part of the current sliding window will lead to incorrect results.

### Mistake 3: Off-by-one Errors in Window Boundaries

Carefully calculate `i - k + 1` to determine the `windowStart` index and ensure elements are removed from the deque only when their index is strictly less than `windowStart`.

### Mistake 4: Using a regular Queue instead of Deque

A regular `Queue` (FIFO) does not allow efficient removal from the back, which is essential for maintaining monotonicity. A `Deque` (double-ended queue) is necessary.

## Monotonic Queue vs. Monotonic Stack

While both use a monotonic data structure, their applications differ:

*   **Monotonic Stack**: Primarily used for finding the **next/previous greater/smaller element** for *each element* in an array. It helps determine relationships between an element and its neighbors.
*   **Monotonic Queue**: Specifically designed for **sliding window maximum/minimum** problems, where the goal is to find the extreme value within *every contiguous window* of a fixed size.

Both patterns achieve `O(n)` time complexity by ensuring each element is processed (pushed and popped) at most a constant number of times.

## Practice Problems for This Pattern

1.  **Sliding Window Maximum** (LeetCode 239) - The classic problem.
2.  **Sliding Window Minimum** (LeetCode 239 variation) - Similar to maximum, but with an increasing monotonic deque.
3.  **Shortest Subarray with Sum at Least K** (LeetCode 862) - A more advanced problem that can use a monotonic queue with prefix sums.

## Interview Script You Can Reuse

```text
"This problem asks for the maximum/minimum in every sliding window of fixed size `k`. A brute-force approach would be O(n*k), and even a priority queue would be O(n log k). To achieve an optimal O(n) solution, I will use a Monotonic Queue, implemented with a `Deque`. I'll store indices in the deque, maintaining them in decreasing order of their corresponding values for maximum (or increasing for minimum). As I iterate, I'll first remove any indices from the front of the deque that are outside the current window. Then, I'll remove elements from the back that are smaller (for max) or larger (for min) than the current element, ensuring monotonicity. Finally, I'll add the current element's index to the back. Once the window has formed, the element at the front of the deque will always be the maximum/minimum for that window."
```

## Final Takeaways

*   **Monotonic Queue** (using `Deque`) is an `O(n)` solution for **sliding window maximum/minimum**.
*   Maintains elements (or indices) in **monotonically decreasing** (for max) or **increasing** (for min) order.
*   Efficiently handles **additions to the back** and **removals from both ends**.
*   Crucial for optimizing problems that require **extreme values within every fixed-size window**.

Mastering the Monotonic Queue pattern is a significant step towards solving complex array and sliding window problems with optimal efficiency.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
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
