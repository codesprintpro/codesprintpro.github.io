---
title: "Kadane's Algorithm in Java: Maximum Sum Subarray"
description: "Master Kadane's Algorithm in Java. Learn how to find the maximum sum of a contiguous subarray in linear time using dynamic programming principles."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "algorithms", "kadane", "subarray", "dynamic programming", "interview preparation"]
featured: false
affiliateSection: "java-courses"
---

Finding the **Maximum Sum Subarray** is a classic problem that can be solved in $O(n^2)$ using brute force. However, **Kadane's Algorithm** allows us to solve it in a single pass ($O(n)$ time and $O(1)$ space).

It is a beautiful application of **Dynamic Programming** where the state is simplified down to just two variables.

## The Core Concept: Local vs. Global Max

The algorithm works by iterating through the array and keeping track of:
1. `currentMax`: The maximum sum of a subarray ending at the current position.
2. `globalMax`: The maximum sum found across the entire array so far.

At each element `x`, you have a choice:
- Start a new subarray with just `x`.
- Add `x` to the existing subarray (`currentMax + x`).

You pick the maximum of those two.

---

## Kadane's Implementation in Java

```java
public class KadanesAlgorithm {
    public int maxSubArray(int[] nums) {
        if (nums == null || nums.length == 0) return 0;

        int currentMax = nums[0];
        int globalMax = nums[0];

        for (int i = 1; i < nums.length; i++) {
            // Decision: Should we start a new subarray or extend the current one?
            currentMax = Math.max(nums[i], currentMax + nums[i]);
            
            // Update the best we've ever seen
            globalMax = Math.max(globalMax, currentMax);
        }

        return globalMax;
    }
}
```

---

## Why is it so efficient?

| Feature | Brute Force | Kadane's |
|---|---|---|
| **Time Complexity** | $O(n^2)$ | $O(n)$ |
| **Space Complexity** | $O(1)$ | $O(1)$ |
| **Passes** | Nested Loops | Single Pass |

## Handling All-Negative Numbers

One common question is: "What if all numbers are negative?"
Kadane's handles this correctly by initializing `currentMax` and `globalMax` with the first element of the array. The algorithm will correctly return the largest (least negative) single element.

## Summary

Kadane's Algorithm is a powerful tool for any contiguous range problem. By realizing that we only need to know the "best so far" to make the next decision, we eliminate thousands of redundant calculations. It is a fundamental pattern that every Java engineer should have memorized for technical interviews.
