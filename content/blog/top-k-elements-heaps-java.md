---
title: "Top K Elements in Java: Mastering the Heap (PriorityQueue) Pattern"
description: "Learn how to solve 'Top K' interview problems in Java using the PriorityQueue pattern. We'll cover K-Largest, K-Smallest, and K-Frequent elements with time and space optimization."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "heap", "priority queue", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

Any time an interview question mentions finding the **"K largest"**, **"K smallest"**, or **"K most frequent"** elements, your brain should immediately think: **Heap**.

In Java, the heap data structure is implemented using the `PriorityQueue` class. Mastering this pattern allows you to reduce a potentially expensive $O(N \log N)$ sorting problem into a much more efficient $O(N \log K)$ solution.

## Why use a Heap instead of Sorting?

If you have 1 million elements and you only need the top 10:
- **Sorting**: $O(N \log N)$ — You sort all 1 million elements just to take 10.
- **Heap**: $O(N \log K)$ — You maintain a small "window" of only 10 elements.

As $N$ grows, the difference becomes massive.

---

## The Golden Rule of Heaps

- To find the **K Largest** elements $\rightarrow$ Use a **Min-Heap**.
- To find the **K Smallest** elements $\rightarrow$ Use a **Max-Heap**.

This sounds counter-intuitive, but here is why: In a Min-Heap of size $K$, the smallest element is at the top. If you find a new element larger than the top, you kick the smallest one out. What remains at the end are the $K$ largest elements.

---

## Pattern 1: K-Largest Elements (Min-Heap)

```java
import java.util.PriorityQueue;
import java.util.ArrayList;
import java.util.List;

public List<Integer> findKLargest(int[] nums, int k) {
    // 1. Create a Min-Heap (default behavior of PriorityQueue)
    PriorityQueue<Integer> minHeap = new PriorityQueue<>();

    // 2. Iterate through all numbers
    for (int num : nums) {
        minHeap.add(num);
        
        // 3. Keep size at K by removing the smallest element
        if (minHeap.size() > k) {
            minHeap.poll();
        }
    }

    // 4. Convert heap to list
    return new ArrayList<>(minHeap);
}
```

---

## Pattern 2: K-Smallest Elements (Max-Heap)

To use a Max-Heap in Java, you provide a comparator to `PriorityQueue`.

```java
import java.util.PriorityQueue;
import java.util.Collections;

public int[] findKSmallest(int[] nums, int k) {
    // 1. Create a Max-Heap
    PriorityQueue<Integer> maxHeap = new PriorityQueue<>(Collections.reverseOrder());

    for (int num : nums) {
        maxHeap.add(num);
        if (maxHeap.size() > k) {
            maxHeap.poll(); // Removes the largest element
        }
    }

    // Result will be the k smallest elements
    return maxHeap.stream().mapToInt(i -> i).toArray();
}
```

---

## Pattern 3: Top K Frequent Elements

This is a very common variation where you first need to count frequencies using a `HashMap`.

```java
import java.util.*;

public List<Integer> topKFrequent(int[] nums, int k) {
    // 1. Count frequencies
    Map<Integer, Integer> counts = new HashMap<>();
    for (int num : nums) counts.put(num, counts.getOrDefault(num, 0) + 1);

    // 2. Min-Heap based on frequency
    PriorityQueue<Integer> heap = new PriorityQueue<>(
        (a, b) -> counts.get(a) - counts.get(b)
    );

    for (int n : counts.keySet()) {
        heap.add(n);
        if (heap.size() > k) heap.poll();
    }

    return new ArrayList<>(heap);
}
```

## When to use the Heap Pattern?

Reach for a `PriorityQueue` when:
- You need the "Top K", "Best K", or "Closest K".
- You need to keep track of the "median" in a stream (Two Heaps pattern).
- You are merging $K$ sorted lists.
- You want to process items in a specific order of "priority" rather than arrival time.

| Problem | Heap Type | Comparator |
|---|---|---|
| K Largest | Min-Heap | `(a, b) -> a - b` |
| K Smallest | Max-Heap | `(a, b) -> b - a` |
| K Closest to X | Min-Heap | `(a, b) -> dist(b) - dist(a)` |
| K Frequent | Min-Heap | `(a, b) -> freq(a) - freq(b)` |

## Summary

The Heap pattern is an essential optimization. It allows you to maintain a "running best" of $K$ elements without the overhead of full sorting. In a Java interview, showing you can use `PriorityQueue` with a custom comparator demonstrates both algorithmic depth and familiarity with the Java Collections Framework.
