---
title: "Prefix Sum Pattern in Java: Efficiently Calculate Range Sums and Subarray Properties"
description: "Master the Prefix Sum pattern in Java to optimize solutions for problems involving range sums, subarray properties, and contiguous segments. Learn precomputation, dry runs, and complexity analysis."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "prefix sum", "arrays", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to the Prefix Sum Pattern

The **Prefix Sum pattern** is a fundamental technique in Data Structures and Algorithms (DSA) used to efficiently answer queries about the sum (or other aggregate properties) of elements within various ranges of an array. It involves **precomputing** the sums of all prefixes of an array, allowing subsequent range sum queries to be answered in `O(1)` time, as opposed to `O(n)` for each query in a naive approach.

This pattern is particularly useful when you need to perform many range sum queries on an array, or when solving problems that involve finding subarrays with specific sum properties. It transforms problems from being time-consuming to highly efficient by trading some initial setup time for faster query times.

## When Should You Think About Prefix Sum?

Consider the Prefix Sum pattern when:

*   You are given an **array of numbers**.
*   You need to calculate the **sum of elements within a specific range** `[i, j]` multiple times.
*   You are looking for **subarrays or contiguous segments** that satisfy a certain sum-related condition.
*   A brute-force solution involves **repeatedly summing elements** within ranges, leading to `O(n)` per query.
*   You can **precompute** information to speed up later queries.

## Core Concept of Prefix Sum

The main idea behind the Prefix Sum pattern is to create an auxiliary array, often called the `prefixSum` array, where `prefixSum[i]` stores the sum of all elements from the beginning of the original array up to index `i-1` (inclusive). If `prefixSum[0]` is initialized to 0, then `prefixSum[i]` stores the sum of the first `i` elements of the original array.

Given an original array `arr` of size `n`:

`prefixSum[0] = 0`
`prefixSum[i] = arr[0] + arr[1] + ... + arr[i-1]` for `i > 0`

To calculate the sum of elements in a range `[i, j]` (inclusive, 0-indexed) from the original array:

`sum(i, j) = prefixSum[j+1] - prefixSum[i]`

This works because `prefixSum[j+1]` contains the sum of elements from `arr[0]` to `arr[j]`, and `prefixSum[i]` contains the sum of elements from `arr[0]` to `arr[i-1]`. Subtracting the latter from the former leaves exactly the sum of elements from `arr[i]` to `arr[j]`.

## Example: Range Sum Query

Given an integer array `nums`, handle multiple queries of the following type:

1.  Calculate the sum of elements of `nums` between indices `left` and `right` inclusive.

#### Brute Force Approach

A naive approach would be to iterate and sum elements for each query.

```java
class NumArrayBruteForce {
    private int[] nums;

    public NumArrayBruteForce(int[] nums) {
        this.nums = nums;
    }

    public int sumRange(int left, int right) {
        int sum = 0;
        for (int i = left; i <= right; i++) {
            sum += nums[i];
        }
        return sum;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)` for each `sumRange` query, where `n` is the length of the range `(right - left + 1)`. If there are `q` queries, total time is `O(q*n)`.
*   **Space Complexity**: `O(1)` (excluding input storage)

#### Optimized with Prefix Sum

We precompute the prefix sums once during initialization. Each `sumRange` query then becomes an `O(1)` operation.

```java
class NumArray {
    private int[] prefixSum;

    public NumArray(int[] nums) {
        prefixSum = new int[nums.length + 1];
        prefixSum[0] = 0; // Base case
        for (int i = 0; i < nums.length; i++) {
            prefixSum[i + 1] = prefixSum[i] + nums[i];
        }
    }

    public int sumRange(int left, int right) {
        // sum(left, right) = prefixSum[right + 1] - prefixSum[left]
        return prefixSum[right + 1] - prefixSum[left];
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)` for initialization (to build the `prefixSum` array). `O(1)` for each `sumRange` query. If there are `q` queries, total time is `O(n + q)`.
*   **Space Complexity**: `O(n)` for the `prefixSum` array.

### Dry Run: Range Sum Query

**Input:** `nums = [-2, 0, 3, -5, 2, -1]`

**Initialization:**

| Index `i` | `nums[i]` | `prefixSum[i+1]` calculation | `prefixSum` array |
|-----------|-----------|------------------------------|-------------------|
| -         | -         | `prefixSum[0] = 0`           | `[0]`             |
| 0         | -2        | `prefixSum[1] = prefixSum[0] + nums[0] = 0 + (-2) = -2` | `[0, -2]`         |
| 1         | 0         | `prefixSum[2] = prefixSum[1] + nums[1] = -2 + 0 = -2` | `[0, -2, -2]`     |
| 2         | 3         | `prefixSum[3] = prefixSum[2] + nums[2] = -2 + 3 = 1` | `[0, -2, -2, 1]`  |
| 3         | -5        | `prefixSum[4] = prefixSum[3] + nums[3] = 1 + (-5) = -4` | `[0, -2, -2, 1, -4]` |
| 4         | 2         | `prefixSum[5] = prefixSum[4] + nums[4] = -4 + 2 = -2` | `[0, -2, -2, 1, -4, -2]` |
| 5         | -1        | `prefixSum[6] = prefixSum[5] + nums[5] = -2 + (-1) = -3` | `[0, -2, -2, 1, -4, -2, -3]` |

**Queries:**

1.  `sumRange(0, 2)`:
    `prefixSum[2+1] - prefixSum[0] = prefixSum[3] - prefixSum[0] = 1 - 0 = 1`
    (Actual sum: `-2 + 0 + 3 = 1`)

2.  `sumRange(2, 5)`:
    `prefixSum[5+1] - prefixSum[2] = prefixSum[6] - prefixSum[2] = -3 - (-2) = -1`
    (Actual sum: `3 + (-5) + 2 + (-1) = -1`)

3.  `sumRange(0, 5)`:
    `prefixSum[5+1] - prefixSum[0] = prefixSum[6] - prefixSum[0] = -3 - 0 = -3`
    (Actual sum: `-2 + 0 + 3 + (-5) + 2 + (-1) = -3`)

## Variations and Applications

The Prefix Sum pattern is not limited to just sums. It can be extended to other aggregate functions and problem types:

*   **2D Prefix Sum (Integral Image)**: For matrices, you can precompute a 2D prefix sum array to answer sum queries for any rectangular submatrix in `O(1)` time.
*   **Equilibrium Index/Point**: Find an index where the sum of elements to its left equals the sum of elements to its right.
*   **Subarray Sum Equals K**: Find the number of subarrays whose sum equals a target `k`. This often combines prefix sums with a hash map.
*   **Finding Pivot Index**: Similar to equilibrium index.
*   **Running Sum**: The prefix sum array itself is a running sum.

## Reusable Template for Prefix Sum

```java
class PrefixSumArray {
    private int[] prefixSum;

    // Constructor to build the prefix sum array
    public PrefixSumArray(int[] arr) {
        if (arr == null || arr.length == 0) {
            prefixSum = new int[1]; // Only prefixSum[0] = 0
            return;
        }
        prefixSum = new int[arr.length + 1];
        prefixSum[0] = 0; // Sum before the first element is 0
        for (int i = 0; i < arr.length; i++) {
            prefixSum[i + 1] = prefixSum[i] + arr[i];
        }
    }

    // Method to get sum of elements in range [left, right] (inclusive, 0-indexed)
    public int getRangeSum(int left, int right) {
        if (left < 0 || right >= prefixSum.length - 1 || left > right) {
            throw new IllegalArgumentException("Invalid range indices");
        }
        return prefixSum[right + 1] - prefixSum[left];
    }

    // Method to get sum of elements from start to index 'i' (inclusive, 0-indexed)
    public int getPrefixSum(int i) {
        if (i < 0 || i >= prefixSum.length - 1) {
            throw new IllegalArgumentException("Invalid index");
        }
        return prefixSum[i + 1];
    }
}
```

## How to Recognize Prefix Sum in Interviews

Look for these indicators:

*   **Array Input**: The problem involves an array of numbers.
*   **Range Queries**: Explicit or implicit need to calculate sums (or other aggregates) over various contiguous subarrays.
*   **Efficiency for Multiple Queries**: If you need to answer many range queries quickly.
*   **Subarray Sum Conditions**: Problems asking to find subarrays with a specific sum, or properties related to subarray sums.

## Common Mistakes

### Mistake 1: Off-by-one errors in `prefixSum` array indexing

It's common to get confused between 0-indexed original array and the `prefixSum` array which is often 1-indexed relative to the original array (i.e., `prefixSum[i]` stores sum up to `arr[i-1]`). Be consistent with your indexing strategy.

### Mistake 2: Incorrectly calculating range sum

Remember the formula: `sum(left, right) = prefixSum[right + 1] - prefixSum[left]`. A common error is using `prefixSum[right] - prefixSum[left-1]` which might lead to incorrect results or `IndexOutOfBoundsException` for `left = 0`.

### Mistake 3: Not handling empty arrays or edge cases

Ensure your `prefixSum` array initialization and `sumRange` method correctly handle cases where the input array is empty or `left` and `right` indices are at the boundaries.

## Prefix Sum vs. Sliding Window

While both patterns deal with contiguous subarrays, their primary applications differ:

*   **Prefix Sum**: Best for problems where you need to calculate the sum of **arbitrary ranges** multiple times. It's a precomputation technique that makes subsequent range queries `O(1)`.
*   **Sliding Window**: Best for problems where you need to find an **optimal contiguous subarray/substring** (e.g., longest, shortest, max sum) by moving a window of elements. It's an `O(n)` traversal technique that avoids redundant calculations by incrementally updating the window.

Sometimes, Prefix Sum can be combined with other techniques (like Hash Maps) to solve problems that might also be solvable with Sliding Window, but often with different time/space trade-offs.

## Practice Problems for This Pattern

1.  **Range Sum Query - Immutable** (LeetCode 303)
2.  **Subarray Sum Equals K** (LeetCode 560) - *Combines Prefix Sum with HashMap.*
3.  **Find Pivot Index** (LeetCode 724)
4.  **Product of Array Except Self** (LeetCode 238) - *Can be solved with a variation of prefix/suffix products.*
5.  **Maximum Subarray** (LeetCode 53) - *While Kadane's is optimal, prefix sums can also be applied.*

## Interview Script You Can Reuse

```text
"This problem requires calculating sums over various ranges. A brute-force approach would be O(n) for each query, leading to O(q*n) total time. To optimize this, I can use the Prefix Sum pattern. I'll precompute a `prefixSum` array where `prefixSum[i]` stores the sum of elements from index 0 to `i-1` of the original array. This takes O(n) time during initialization. Then, any range sum query `sum(left, right)` can be answered in O(1) time using the formula `prefixSum[right + 1] - prefixSum[left]`. This makes the overall solution much more efficient, especially for a large number of queries."
```

## Final Takeaways

*   **Prefix Sum** is a precomputation technique for efficient range queries.
*   It reduces range sum query time from `O(n)` to `O(1)` after `O(n)` initialization.
*   Crucial for problems involving **multiple range sum queries** or **subarray sum properties**.
*   Pay close attention to **indexing** in the `prefixSum` array.
*   Can be combined with **Hash Maps** for more complex subarray sum problems.

Mastering Prefix Sum is essential for optimizing array-based problems and forms a strong foundation for more advanced techniques.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
*   [Sliding Window Pattern in Java](/blog/sliding-window-pattern-java/)
*   [Two Pointers Pattern in Java](/blog/two-pointers-pattern-java/)
*   [Big-O Notation in Java](/blog/big-o-notation-java-interview-problem-solving/)
