---
title: "Kadane’s Algorithm in Java: Finding the Maximum Subarray Sum Efficiently"
description: "Master Kadane's Algorithm in Java to find the maximum sum of a contiguous subarray. Learn its intuition, dynamic programming approach, dry runs, and complexity analysis for optimal solutions."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "kadane's algorithm", "arrays", "dynamic programming", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to Kadane’s Algorithm

**Kadane’s Algorithm** is a classic and highly efficient dynamic programming approach used to find the maximum sum of a contiguous subarray within a one-dimensional array of numbers. This problem is frequently encountered in technical interviews due to its elegant solution that reduces a seemingly complex problem to a linear time complexity.

The beauty of Kadane's Algorithm lies in its simplicity and the powerful intuition behind it: at each position in the array, you decide whether to extend the current subarray or start a new one, based on which choice yields a larger sum. This greedy-like decision-making process ensures that the global maximum sum is eventually found.

## When Should You Think About Kadane’s Algorithm?

Consider Kadane’s Algorithm when:

*   You are given a **one-dimensional array of numbers** (integers, positive, negative, or mixed).
*   You need to find the **maximum sum of a contiguous subarray**.
*   The problem explicitly asks for the maximum sum of a *subarray* (contiguous elements), not a subsequence (non-contiguous elements).
*   A brute-force solution involves checking all possible subarrays, leading to `O(n^2)` or `O(n^3)` time complexity.

## Core Concept of Kadane’s Algorithm

The algorithm maintains two key variables:

1.  `currentMax`: The maximum sum of a subarray ending at the current position.
2.  `globalMax`: The maximum sum found so far across all subarrays.

As you iterate through the array, for each element `num` at index `i`:

*   `currentMax` is updated to be the maximum of `num` (starting a new subarray) or `currentMax + num` (extending the current subarray). This decision is crucial: if `currentMax + num` is less than `num`, it means the previous `currentMax` was negative and dragging down the sum, so it's better to start a new subarray from `num`.
*   `globalMax` is updated to be the maximum of `globalMax` and `currentMax`. This ensures `globalMax` always stores the largest sum encountered.

This process guarantees that `globalMax` will hold the maximum sum of any contiguous subarray by the end of the iteration.

## Example: Maximum Subarray Sum

Given an integer array `nums`, find the contiguous subarray (containing at least one number) which has the largest sum and return its sum.

#### Brute Force Approach

A naive approach would involve checking every possible subarray. For an array of length `n`, there are `n * (n + 1) / 2` possible subarrays. Calculating the sum for each takes `O(n)` in the worst case, leading to `O(n^3)` overall. An optimization can bring it down to `O(n^2)` by reusing sums.

```java
class Solution {
    public int maxSubArrayBruteForce(int[] nums) {
        if (nums == null || nums.length == 0) {
            return 0; // Or throw IllegalArgumentException
        }

        int globalMax = Integer.MIN_VALUE;

        for (int i = 0; i < nums.length; i++) {
            int currentWindowSum = 0;
            for (int j = i; j < nums.length; j++) {
                currentWindowSum += nums[j];
                globalMax = Math.max(globalMax, currentWindowSum);
            }
        }
        return globalMax;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n^2)`.
*   **Space Complexity**: `O(1)`.

#### Optimized with Kadane’s Algorithm

```java
class Solution {
    public int maxSubArray(int[] nums) {
        if (nums == null || nums.length == 0) {
            return 0; // Or throw IllegalArgumentException
        }

        int currentMax = nums[0]; // Max sum ending at current position
        int globalMax = nums[0];  // Overall max sum found so far

        for (int i = 1; i < nums.length; i++) {
            // Decide whether to extend the current subarray or start a new one
            currentMax = Math.max(nums[i], currentMax + nums[i]);
            
            // Update the overall maximum sum
            globalMax = Math.max(globalMax, currentMax);
        }

        return globalMax;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, as we iterate through the array only once.
*   **Space Complexity**: `O(1)`.

### Dry Run: Maximum Subarray Sum

**Input:** `nums = [-2, 1, -3, 4, -1, 2, 1, -5, 4]`

| Index `i` | `nums[i]` | `currentMax` (before) | `currentMax` (after `Math.max(nums[i], currentMax + nums[i])`) | `globalMax` (before) | `globalMax` (after `Math.max(globalMax, currentMax)`) | Notes |
|-----------|-----------|-----------------------|-------------------------------------------------------------------|----------------------|--------------------------------------------------------|-------|
| -         | -         | -                     | -                                                                 | -                    | -                                                      | Initialize `currentMax = nums[0] = -2`, `globalMax = nums[0] = -2` |
| 1         | 1         | -2                    | `Math.max(1, -2 + 1) = Math.max(1, -1) = 1`                       | -2                   | `Math.max(-2, 1) = 1`                                  | Start new subarray from 1 |
| 2         | -3        | 1                     | `Math.max(-3, 1 + -3) = Math.max(-3, -2) = -2`                    | 1                    | `Math.max(1, -2) = 1`                                  | Extend subarray |
| 3         | 4         | -2                    | `Math.max(4, -2 + 4) = Math.max(4, 2) = 4`                        | 1                    | `Math.max(1, 4) = 4`                                   | Start new subarray from 4 |
| 4         | -1        | 4                     | `Math.max(-1, 4 + -1) = Math.max(-1, 3) = 3`                      | 4                    | `Math.max(4, 3) = 4`                                   | Extend subarray |
| 5         | 2         | 3                     | `Math.max(2, 3 + 2) = Math.max(2, 5) = 5`                         | 4                    | `Math.max(4, 5) = 5`                                   | Extend subarray |
| 6         | 1         | 5                     | `Math.max(1, 5 + 1) = Math.max(1, 6) = 6`                         | 5                    | `Math.max(5, 6) = 6`                                   | Extend subarray |
| 7         | -5        | 6                     | `Math.max(-5, 6 + -5) = Math.max(-5, 1) = 1`                      | 6                    | `Math.max(6, 1) = 6`                                   | Extend subarray |
| 8         | 4         | 1                     | `Math.max(4, 1 + 4) = Math.max(4, 5) = 5`                         | 6                    | `Math.max(6, 5) = 6`                                   | Extend subarray |

**Result:** `globalMax = 6` (corresponding to subarray `[4, -1, 2, 1]`)

## Reusable Template for Kadane’s Algorithm

```java
class Kadane {
    public int findMaxSubarraySum(int[] nums) {
        if (nums == null || nums.length == 0) {
            // Handle empty or null array case as per problem requirements
            // e.g., throw new IllegalArgumentException("Input array cannot be empty or null");
            return 0; // Or Integer.MIN_VALUE if negative sums are possible and valid
        }

        int currentMax = nums[0]; // Maximum sum ending at the current position
        int globalMax = nums[0];  // Overall maximum sum found so far

        for (int i = 1; i < nums.length; i++) {
            // Option 1: Start a new subarray from nums[i]
            // Option 2: Extend the current subarray by adding nums[i]
            currentMax = Math.max(nums[i], currentMax + nums[i]);
            
            // Update the global maximum if currentMax is greater
            globalMax = Math.max(globalMax, currentMax);
        }

        return globalMax;
    }
}
```

## How to Recognize Kadane’s Algorithm in Interviews

Look for these specific cues:

*   **Input**: A one-dimensional array of numbers.
*   **Goal**: Find the **maximum sum of a *contiguous* subarray**.
*   **Constraints**: Often involves positive and negative numbers, making simple sum tracking insufficient.
*   **Efficiency**: When an `O(n)` solution is required, and brute-force `O(n^2)` is too slow.

If the problem asks for the maximum sum of a *subsequence* (elements don't have to be contiguous), Kadane's is not directly applicable. For subsequences, you would simply sum all positive numbers.

## Common Mistakes

### Mistake 1: Incorrect Initialization

If the array can contain all negative numbers, initializing `globalMax` and `currentMax` to `0` will incorrectly return `0` instead of the largest negative number. Always initialize them with the first element of the array (or `Integer.MIN_VALUE` if the problem guarantees at least one element and you want to handle all negative numbers correctly).

### Mistake 2: Confusing Subarray with Subsequence

Kadane's Algorithm is strictly for *contiguous* subarrays. If the problem allows non-contiguous elements, it's a different problem (usually much simpler: just sum all positive numbers).

### Mistake 3: Not handling empty or null arrays

Always add checks for `null` or empty arrays to prevent `IndexOutOfBoundsException`.

## Kadane’s Algorithm vs. Prefix Sum

While both can be used for array sum problems, their applications differ:

*   **Prefix Sum**: Primarily a **precomputation technique** to answer multiple range sum queries in `O(1)` time after an `O(n)` setup. It helps find the sum of *any* given range `[i, j]`.
*   **Kadane’s Algorithm**: A **dynamic programming algorithm** specifically designed to find the *maximum sum contiguous subarray* in `O(n)` time. It doesn't answer arbitrary range sum queries but efficiently solves a specific optimization problem.

Sometimes, problems that can be solved with Kadane's can also be approached with Prefix Sums (e.g., `max(prefixSum[j] - prefixSum[i])`), but Kadane's is generally more direct and efficient for its specific use case.

## Practice Problems for This Pattern

1.  **Maximum Subarray** (LeetCode 53) - The classic problem.
2.  **Maximum Product Subarray** (LeetCode 152) - A variation requiring slight modification to track min product as well.
3.  **Maximum Sum Circular Subarray** (LeetCode 918) - Requires finding max subarray sum and min subarray sum.
4.  **Best Time to Buy and Sell Stock** (LeetCode 121) - Can be reframed as finding the maximum subarray sum of differences.

## Interview Script You Can Reuse

```text
"This problem asks for the maximum sum of a contiguous subarray, which is a classic application of Kadane’s Algorithm. I’ll maintain two variables: `currentMax` to track the maximum sum ending at the current position, and `globalMax` to track the overall maximum sum found so far. As I iterate through the array, `currentMax` will be updated by taking the maximum of the current element itself (starting a new subarray) or extending the previous `currentMax` with the current element. `globalMax` will then be updated with the larger of `globalMax` and `currentMax`. This approach allows us to solve the problem in a single pass, achieving an optimal O(n) time complexity with O(1) space."
```

## Final Takeaways

*   **Kadane’s Algorithm** efficiently finds the maximum sum of a **contiguous subarray**.
*   It's a **dynamic programming** approach with a greedy choice at each step.
*   Achieves **`O(n)` time complexity** and **`O(1)` space complexity**.
*   Crucial for problems involving **optimization of subarray sums**.
*   Careful **initialization** is key, especially for arrays with negative numbers.

Kadane's Algorithm is a must-know for any aspiring software engineer, demonstrating how a simple, iterative solution can solve a complex problem optimally.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
*   [Prefix Sum Pattern in Java](/blog/prefix-sum-pattern-java/)
*   [Sliding Window Pattern in Java](/blog/sliding-window-pattern-java/)
*   [Two Pointers Pattern in Java](/blog/two-pointers-pattern-java/)
*   [Big-O Notation in Java](/blog/big-o-notation-java-interview-problem-solving/)
