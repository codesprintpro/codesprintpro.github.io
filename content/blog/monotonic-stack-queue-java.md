---
title: "Monotonic Stack and Queue in Java: Optimized Range Queries"
description: "Master the monotonic stack and queue patterns in Java. Learn how to solve 'Next Greater Element' and 'Sliding Window Maximum' problems in linear time."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "stack", "queue", "monotonic", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

A **Monotonic Stack** or **Queue** is a data structure that maintains its elements in a specific order (either non-increasing or non-decreasing).

While simple in concept, it is the key to turning $O(n^2)$ nested-loop problems into efficient $O(n)$ linear-time solutions. It is most commonly used for problems involving "the nearest element that is larger/smaller" or "the maximum/minimum in a range".

---

## 1. Monotonic Stack: Next Greater Element

The goal is to find, for each element in an array, the first element to its right that is larger.

**The Logic**:
1. Iterate through the array.
2. While the current element is larger than the element at the top of the stack, we found the "Next Greater Element" for the stack top.
3. Pop the stack top and record the result.
4. Push the current element onto the stack.

```java
import java.util.Stack;

public int[] nextGreaterElement(int[] nums) {
    int n = nums.length;
    int[] result = new int[n];
    Stack<Integer> stack = new Stack<>(); // Stores indices

    // Initialize result with -1
    for (int i = 0; i < n; i++) result[i] = -1;

    for (int i = 0; i < n; i++) {
        while (!stack.isEmpty() && nums[i] > nums[stack.peek()]) {
            int prevIndex = stack.pop();
            result[prevIndex] = nums[i];
        }
        stack.push(i);
    }
    return result;
}
```

---

## 2. Monotonic Queue: Sliding Window Maximum

Given an array and a window size `k`, find the maximum element in every sliding window.

A **Deque** (Double-Ended Queue) is used to keep indices of elements in a non-increasing order. The maximum for the current window will always be at the `peekFirst()`.

```java
import java.util.Deque;
import java.util.LinkedList;

public int[] maxSlidingWindow(int[] nums, int k) {
    if (nums == null || nums.length == 0) return new int[0];
    
    int n = nums.length;
    int[] result = new int[n - k + 1];
    Deque<Integer> deque = new LinkedList<>(); // Stores indices

    for (int i = 0; i < n; i++) {
        // 1. Remove indices that are out of the current window
        if (!deque.isEmpty() && deque.peekFirst() < i - k + 1) {
            deque.pollFirst();
        }

        // 2. Remove indices of elements smaller than current (maintain monotonic)
        while (!deque.isEmpty() && nums[deque.peekLast()] < nums[i]) {
            deque.pollLast();
        }

        deque.offerLast(i);

        // 3. Add to result once window is full
        if (i >= k - 1) {
            result[i - k + 1] = nums[deque.peekFirst()];
        }
    }
    return result;
}
```

## When to use Monotonic Patterns?

| Pattern | Problem Type | Complexity |
|---|---|---|
| **Monotonic Stack** | Next/Previous Greater/Smaller element | $O(n)$ |
| **Monotonic Stack** | Largest Rectangle in Histogram | $O(n)$ |
| **Monotonic Queue** | Max/Min in a sliding window | $O(n)$ |
| **Monotonic Queue** | Shortest subarray with sum at least K | $O(n)$ |

## Summary

Monotonic data structures are all about **discarding useless information**. If you are looking for the next greater element and you see a new larger value, everything smaller that came before it is no longer relevant for future elements. By maintaining this strict order, you ensure that every element is pushed and popped exactly once, resulting in a perfect linear time complexity.
