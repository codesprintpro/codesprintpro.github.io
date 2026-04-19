---
title: "Sliding Window Pattern in Java: Master Subarray and Substring Problems"
description: "A comprehensive guide to the sliding window pattern in Java. Learn the difference between fixed and dynamic windows, reusable templates, and how to optimize O(n^2) problems to O(n)."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "sliding window", "arrays", "strings", "interview preparation", "algorithms"]
featured: true
affiliateSection: "java-courses"
---

If you are asked to find a subarray, a substring, or a contiguous segment that meets a certain condition, the **Sliding Window** pattern should be the first tool you reach for.

It is the evolution of the Two Pointers pattern, specifically designed to handle "windows" of data without recalculating everything from scratch as the window moves.

## The Core Intuition

Imagine you have a long list of numbers and you need to find the maximum sum of any 3 consecutive elements.

**The Brute Force way:**
For every single element, look at the next two, add them up, and keep track of the max. You are re-adding elements over and over.

**The Sliding Window way:**
Calculate the sum of the first 3. To move to the next window, simply **add** the new element entering from the right and **subtract** the old element leaving from the left.

This turns an `O(n * k)` problem into an `O(n)` solution.

## Types of Sliding Windows

In interviews, you will encounter two main variants:

1. **Fixed Size Window**: The window length `k` is constant (e.g., "Find the max sum of any subarray of size 3").
2. **Dynamic (Variable) Size Window**: The window grows and shrinks based on a condition (e.g., "Find the shortest subarray with a sum $\ge$ X").

---

## Pattern 1: Fixed Size Window

The logic is straightforward:
1. Initialize the window by processing the first `k` elements.
2. Slide the window one step at a time: add the next element, remove the leftmost element, and update your result.

### Example: Maximum Sum Subarray of Size K

```java
public int findMaxSumSubarray(int[] arr, int k) {
    int maxTotal = 0;
    int currentWindowSum = 0;

    // 1. Compute initial window
    for (int i = 0; i < k; i++) {
        currentWindowSum += arr[i];
    }
    maxTotal = currentWindowSum;

    // 2. Slide the window
    for (int i = k; i < arr.length; i++) {
        currentWindowSum += arr[i] - arr[i - k]; // Add new, subtract old
        maxTotal = Math.max(maxTotal, currentWindowSum);
    }

    return maxTotal;
}
```

---

## Pattern 2: Dynamic Size Window

This is the "Expand and Contract" pattern. It is slightly more complex but extremely common.

**The Template:**
1. Use a pointer `right` to expand the window.
2. Inside the loop, add `arr[right]` to your window state.
3. Use a `while` loop to shrink the window from the `left` as long as the condition is met (or violated, depending on the problem).
4. Update the global result.

### Example: Smallest Subarray with Sum $\ge$ Target

```java
public int minSubArrayLen(int target, int[] nums) {
    int minLength = Integer.MAX_VALUE;
    int windowSum = 0;
    int left = 0;

    for (int right = 0; right < nums.length; right++) {
        // Expand
        windowSum += nums[right];

        // Contract
        while (windowSum >= target) {
            minLength = Math.min(minLength, right - left + 1);
            windowSum -= nums[left];
            left++;
        }
    }

    return minLength == Integer.MAX_VALUE ? 0 : minLength;
}
```

## When to Use Sliding Window?

Look for these keywords in the problem description:
- Contiguous subarray or substring
- "Maximum", "Minimum", "Longest", "Shortest"
- A constraint (sum, k unique characters, distinct elements)

| Problem Type | Tool | Complexity |
|---|---|---|
| All pairs/subarrays | Brute Force | `O(n^2)` |
| Pairs in sorted array | Two Pointers | `O(n)` |
| Contiguous segment | Sliding Window | `O(n)` |

## Memory Cheat Sheet

- **State Management**: What do you need to track inside the window? (Sum? Frequency Map? Max element?)
- **Edge Cases**: Empty array, `k` larger than array size, no solution exists.
- **Time Complexity**: Even though there is a `while` loop inside a `for` loop, each pointer only moves from left to right **once**. This makes it `O(n)`.

## Summary

The Sliding Window is all about **reusing work**. By maintaining the state of the current window and only updating what changes, you eliminate redundant calculations and produce the kind of optimized code interviewers expect.
