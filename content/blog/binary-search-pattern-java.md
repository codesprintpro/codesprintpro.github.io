---
title: "Binary Search Pattern in Java: Efficiently Searching Sorted Data"
description: "Master the Binary Search pattern in Java for efficiently searching sorted arrays. Learn its intuition, algorithm, dry runs, and variations like searching in rotated arrays and on answers."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "binary search", "arrays", "searching", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to the Binary Search Pattern

The **Binary Search pattern** is a highly efficient algorithm for finding an item from a sorted list of items. It works by repeatedly dividing in half the portion of the list that could contain the item, until you've narrowed down the possible locations to just one. This technique is fundamental in computer science and is a cornerstone for many other advanced algorithms.

Its efficiency stems from its ability to eliminate half of the search space in each step, leading to a logarithmic time complexity, which is significantly faster than linear search for large datasets.

## When Should You Think About Binary Search?

Consider the Binary Search pattern when:

*   You are given a **sorted array or list** (or a data structure that can be treated as sorted, like a rotated sorted array).
*   You need to **find a specific element**, its first/last occurrence, or an element satisfying a condition.
*   You need to find a value in a **range** where the property changes monotonically (e.g., finding the smallest `x` such that `P(x)` is true, where `P(x)` is monotonic).
*   An `O(log n)` time complexity solution is desired.

## Core Concept of Binary Search

The algorithm works by maintaining a search space defined by two pointers, `low` and `high`, representing the start and end indices of the current search range. In each step:

1.  Calculate the `mid` index: `mid = low + (high - low) / 2` (to prevent overflow).
2.  Compare the element at `arr[mid]` with the `target`:
    *   If `arr[mid] == target`, the element is found.
    *   If `arr[mid] < target`, the target must be in the right half, so update `low = mid + 1`.
    *   If `arr[mid] > target`, the target must be in the left half, so update `high = mid - 1`.
3.  Repeat until `low > high`, which means the target is not in the array.

## Example 1: Classic Binary Search

Given a sorted array of integers `nums` and an integer `target`, return the index of `target` if it is in `nums`, otherwise return `-1`.

#### Brute Force Approach

A linear search would iterate through each element until the target is found or the end of the array is reached.

```java
class Solution {
    public int searchBruteForce(int[] nums, int target) {
        for (int i = 0; i < nums.length; i++) {
            if (nums[i] == target) {
                return i;
            }
        }
        return -1;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, as in the worst case, we might have to check every element.
*   **Space Complexity**: `O(1)`.

#### Optimized with Binary Search

```java
class Solution {
    public int search(int[] nums, int target) {
        if (nums == null || nums.length == 0) {
            return -1;
        }

        int low = 0;
        int high = nums.length - 1;

        while (low <= high) {
            int mid = low + (high - low) / 2; // Prevent potential overflow

            if (nums[mid] == target) {
                return mid;
            } else if (nums[mid] < target) {
                low = mid + 1;
            } else { // nums[mid] > target
                high = mid - 1;
            }
        }
        return -1; // Target not found
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(log n)`, as the search space is halved in each step.
*   **Space Complexity**: `O(1)`.

### Dry Run: Classic Binary Search

**Input:** `nums = [-1, 0, 3, 5, 9, 12]`, `target = 9`

| Step | `low` | `high` | `mid` | `nums[mid]` | Comparison (`nums[mid]` vs `target`) | Action      |
|------|-------|--------|-------|-------------|--------------------------------------|-------------|
| Init | 0     | 5      | -     | -           | -                                    |             |
| 1    | 0     | 5      | 2     | 3           | `3 < 9`                              | `low = 2 + 1 = 3` |
| 2    | 3     | 5      | 4     | 9           | `9 == 9`                             | Return `4`  |

**Result:** `4`

## Example 2: Search in Rotated Sorted Array

Given a sorted array `nums` that has been rotated at some pivot unknown to you beforehand (e.g., `[0,1,2,4,5,6,7]` might become `[4,5,6,7,0,1,2]`). Find the `target` value.

This is a common variation where binary search is still applicable, but the logic for narrowing the search space becomes more complex.

```java
class Solution {
    public int searchRotated(int[] nums, int target) {
        if (nums == null || nums.length == 0) {
            return -1;
        }

        int low = 0;
        int high = nums.length - 1;

        while (low <= high) {
            int mid = low + (high - low) / 2;

            if (nums[mid] == target) {
                return mid;
            }

            // Determine which half is sorted
            if (nums[low] <= nums[mid]) { // Left half is sorted
                if (target >= nums[low] && target < nums[mid]) {
                    high = mid - 1; // Target is in the sorted left half
                } else {
                    low = mid + 1;  // Target is in the unsorted right half
                }
            } else { // Right half is sorted
                if (target > nums[mid] && target <= nums[high]) {
                    low = mid + 1;  // Target is in the sorted right half
                } else {
                    high = mid - 1; // Target is in the unsorted left half
                }
            }
        }
        return -1;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(log n)`, as in each step, we effectively eliminate half of the search space.
*   **Space Complexity**: `O(1)`.

### Dry Run: Search in Rotated Sorted Array

**Input:** `nums = [4, 5, 6, 7, 0, 1, 2]`, `target = 0`

| Step | `low` | `high` | `mid` | `nums[mid]` | `nums[low]` | `nums[high]` | Condition (`nums[low] <= nums[mid]`) | Target in sorted half? | Action      |
|------|-------|--------|-------|-------------|-------------|--------------|--------------------------------------|------------------------|-------------|
| Init | 0     | 6      | -     | -           | -           | -            | -                                    | -                      |             |
| 1    | 0     | 6      | 3     | 7           | 4           | 2            | `4 <= 7` (True, left sorted)         | `0 >= 4 && 0 < 7` (False) | `low = 3 + 1 = 4` |
| 2    | 4     | 6      | 5     | 1           | 0           | 2            | `0 <= 1` (True, left sorted)         | `0 >= 0 && 0 < 1` (True)  | `high = 5 - 1 = 4` |
| 3    | 4     | 4      | 4     | 0           | 0           | 2            | `0 == 0` (True)                      | `0 == 0` (True)        | Return `4`  |

**Result:** `4`

## Reusable Template for Binary Search

```java
class BinarySearchTemplate {
    // Classic Binary Search (find exact target)
    public int classicBinarySearch(int[] nums, int target) {
        if (nums == null || nums.length == 0) {
            return -1;
        }

        int low = 0;
        int high = nums.length - 1;

        while (low <= high) {
            int mid = low + (high - low) / 2;

            if (nums[mid] == target) {
                return mid;
            } else if (nums[mid] < target) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return -1;
    }

    // Binary Search for first occurrence (e.g., find first element >= target)
    public int findFirstOccurrence(int[] nums, int target) {
        if (nums == null || nums.length == 0) {
            return -1;
        }

        int low = 0;
        int high = nums.length - 1;
        int result = -1;

        while (low <= high) {
            int mid = low + (high - low) / 2;
            if (nums[mid] >= target) {
                result = mid; // Potential answer, try to find an earlier one
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }
        return result;
    }

    // Binary Search for last occurrence (e.g., find last element <= target)
    public int findLastOccurrence(int[] nums, int target) {
        if (nums == null || nums.length == 0) {
            return -1;
        }

        int low = 0;
        int high = nums.length - 1;
        int result = -1;

        while (low <= high) {
            int mid = low + (high - low) / 2;
            if (nums[mid] <= target) {
                result = mid; // Potential answer, try to find a later one
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return result;
    }
}
```

## How to Recognize Binary Search in Interviews

Look for these clues:

*   **Sorted Data**: The input array or list is explicitly sorted, or can be sorted without affecting the problem (e.g., finding a pair).
*   **Search/Find**: The problem asks to find a specific element, its position, or an element satisfying a condition.
*   **Monotonic Property**: The search space has a property that is monotonic (e.g., increasing or decreasing). This allows you to eliminate half the space.
*   **Efficiency**: When `O(log n)` time complexity is required or hinted at.
*   **"Search on Answer"**: Problems where you need to find an optimal value (e.g., minimum maximum, maximum minimum) that can be verified by a monotonic function. You binary search on the *range of possible answers* rather than the array indices.

## Common Mistakes

### Mistake 1: Integer Overflow in `mid` calculation

Using `(low + high) / 2` can lead to overflow if `low + high` exceeds `Integer.MAX_VALUE`. Always use `low + (high - low) / 2`.

### Mistake 2: Incorrect Loop Condition

`while (low <= high)` is typically used when the `target` could be `nums[mid]`. If the loop condition is `while (low < high)`, the loop might terminate one step too early, requiring post-processing.

### Mistake 3: Incorrectly Updating `low` and `high`

Ensure `low = mid + 1` and `high = mid - 1` are used correctly to avoid infinite loops or missing the target. If `mid` itself is a potential answer, adjust pointers to search in the remaining half.

### Mistake 4: Not Handling Edge Cases

Consider empty arrays, single-element arrays, or target values outside the array range.

## Binary Search vs. Other Search Algorithms

*   **Binary Search**: `O(log n)` time complexity, requires sorted data. Highly efficient for large datasets.
*   **Linear Search**: `O(n)` time complexity, works on unsorted data. Simple but inefficient for large datasets.
*   **Hash Table Search**: `O(1)` average time complexity, but requires `O(n)` space for the hash table. Does not require sorted data.

## Practice Problems for This Pattern

1.  **Binary Search** (LeetCode 704) - The classic problem.
2.  **Search Insert Position** (LeetCode 35) - Find where to insert an element to maintain sorted order.
3.  **Find First and Last Position of Element in Sorted Array** (LeetCode 34) - Variations for first/last occurrence.
4.  **Search in Rotated Sorted Array** (LeetCode 33) - A common and important variation.
5.  **Find Minimum in Rotated Sorted Array** (LeetCode 153) - Another variation on rotated arrays.
6.  **Sqrt(x)** (LeetCode 69) - Example of "Search on Answer" where you binary search on the range of possible square roots.

## Interview Script You Can Reuse

```text
"This problem involves searching in a sorted array, which makes Binary Search an ideal candidate for an optimal O(log n) solution. I'll use two pointers, `low` and `high`, to define my search space. In each iteration, I'll calculate `mid` and compare `nums[mid]` with the target. If `nums[mid]` is the target, I return `mid`. If `nums[mid]` is less than the target, I know the target must be in the right half, so I update `low = mid + 1`. Otherwise, if `nums[mid]` is greater, the target is in the left half, and I update `high = mid - 1`. This process continues until `low` crosses `high`, indicating the target is not found. This approach guarantees logarithmic time complexity and O(1) space."
```

## Final Takeaways

*   **Binary Search** is an `O(log n)` algorithm for **sorted data**.
*   It works by **halving the search space** in each step.
*   Crucial for problems involving **efficient searching** or **monotonic properties**.
*   Pay attention to **`mid` calculation** and **pointer updates** to avoid common errors.
*   Variations like "Search in Rotated Sorted Array" and "Search on Answer" extend its applicability.

Binary Search is a fundamental algorithm that every developer should master due to its widespread use and efficiency.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
*   [In-place Reversal of a Linked List in Java](/blog/in-place-linked-list-reversal-java/)
*   [Fast & Slow Pointers in Java](/blog/fast-slow-pointers-java/)
*   [Dutch National Flag Pattern in Java](/blog/dutch-national-flag-pattern-java/)
*   [Kadane’s Algorithm in Java](/blog/kadanes-algorithm-java/)
*   [Prefix Sum Pattern in Java](/blog/prefix-sum-pattern-java/)
*   [Sliding Window Pattern in Java](/blog/sliding-window-pattern-java/)
*   [Two Pointers Pattern in Java](/blog/two-pointers-pattern-java/)
*   [Big-O Notation in Java](/blog/big-o-notation-java-interview-problem-solving/)
