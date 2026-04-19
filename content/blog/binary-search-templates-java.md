---
title: "Binary Search Templates in Java: Never Get Stuck on Off-by-One Errors"
description: "Master Binary Search in Java with three clean templates that cover everything from basic search to finding boundaries (left-most/right-most) and search space optimization."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "binary search", "arrays", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

Binary search is one of the most powerful algorithms in your toolkit, but it is also one of the most bug-prone.

Almost every developer has struggled with:
- Should I use `left < right` or `left <= right`?
- Should I update `right = mid` or `right = mid - 1`?
- How do I find the first occurrence instead of any occurrence?

This guide provides three clean, reusable Java templates that eliminate the guesswork.

## The Core Concept: Divide and Conquer

Binary search works on any **monotonically** increasing or decreasing search space (usually a sorted array).

By checking the middle element, we can discard half of the search space in each step, leading to a time complexity of `O(log n)`.

---

## Template 1: Basic Binary Search (Find Exact Value)

Use this when you just need to find if an element exists and return its index.

```java
public int binarySearch(int[] nums, int target) {
    int left = 0;
    int right = nums.length - 1;

    while (left <= right) {
        int mid = left + (right - left) / 2; // Avoid overflow
        
        if (nums[mid] == target) {
            return mid;
        } else if (nums[mid] < target) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }
    return -1;
}
```

---

## Template 2: Binary Search for Boundaries (Left-most / Right-most)

This is the most common version in real interviews. Use this to find:
- The first occurrence of a target (Lower Bound)
- The first element greater than target
- The insertion point

### Finding the Left-most (First) Occurrence

```java
public int findLeftBound(int[] nums, int target) {
    int left = 0;
    int right = nums.length; // Note: right is nums.length

    while (left < right) {
        int mid = left + (right - left) / 2;
        if (nums[mid] < target) {
            left = mid + 1;
        } else {
            right = mid; // Shrink from right to find earliest
        }
    }
    
    // Validate if target was found
    if (left == nums.length || nums[left] != target) return -1;
    return left;
}
```

---

## Template 3: Binary Search on Answer (Optimization)

Sometimes, the "array" isn't given. Instead, you are searching for a value within a range (e.g., "What is the minimum speed required to finish this task in H hours?").

```java
public int searchSpace(int minPossible, int maxPossible, Object input) {
    int left = minPossible;
    int right = maxPossible;
    int ans = -1;

    while (left <= right) {
        int mid = left + (right - left) / 2;
        if (canFinish(mid, input)) {
            ans = mid;      // Record possible answer
            right = mid - 1; // Try to find a smaller/better answer
        } else {
            left = mid + 1;
        }
    }
    return ans;
}

private boolean canFinish(int value, Object input) {
    // Condition logic goes here
    return true;
}
```

## Binary Search Mental Checklist

1. **Avoid Overflow**: Always use `mid = left + (right - left) / 2` instead of `(left + right) / 2`.
2. **Termination Condition**: 
   - `left <= right` usually pairs with `left = mid + 1` and `right = mid - 1`.
   - `left < right` usually pairs with `left = mid + 1` and `right = mid`.
3. **The Search Space**: If the array is sorted, it's a binary search. If you are looking for a "min/max value that satisfies X", it's a binary search on the answer.

## Summary

Binary search is about more than just sorted arrays; it's about efficiently narrowing down a range. By mastering these three templates, you can solve `O(log n)` problems with confidence and zero off-by-one errors.
