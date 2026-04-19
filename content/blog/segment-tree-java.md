---
title: "Segment Trees in Java: Efficient Range Queries and Updates"
description: "Master Segment Trees in Java. Learn how to perform range sum or range min/max queries and point updates in O(log n) time, a must-know for competitive programming."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "segment tree", "range query", "optimization", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

A **Segment Tree** is a versatile data structure used for storing information about intervals or segments. It allows querying a range (like a sum or minimum) and updating an element in **$O(\log n)$** time.

While a prefix sum array can do range sum queries in $O(1)$, it takes $O(n)$ to update an element. A Segment Tree provides the best balance for **dynamic data**.

## The Structure of a Segment Tree

A Segment Tree for an array of size $n$ is a binary tree where:
- Each leaf node represents an individual element of the array.
- Each internal node represents a "segment" (range) of the array and stores the result (sum, min, etc.) of that range.

For an array of size $n$, the segment tree requires roughly $4n$ space.

---

## Segment Tree Implementation in Java (Range Sum)

```java
public class SegmentTree {
    private int[] tree;
    private int n;

    public SegmentTree(int[] nums) {
        if (nums.length > 0) {
            n = nums.length;
            tree = new int[4 * n];
            build(nums, 1, 0, n - 1);
        }
    }

    private void build(int[] nums, int node, int start, int end) {
        if (start == end) {
            tree[node] = nums[start];
            return;
        }
        int mid = (start + end) / 2;
        build(nums, 2 * node, start, mid);
        build(nums, 2 * node + 1, mid + 1, end);
        tree[node] = tree[2 * node] + tree[2 * node + 1];
    }

    public void update(int index, int val) {
        update(1, 0, n - 1, index, val);
    }

    private void update(int node, int start, int end, int idx, int val) {
        if (start == end) {
            tree[node] = val;
            return;
        }
        int mid = (start + end) / 2;
        if (idx <= mid) update(2 * node, start, mid, idx, val);
        else update(2 * node + 1, mid + 1, end, idx, val);
        tree[node] = tree[2 * node] + tree[2 * node + 1];
    }

    public int query(int l, int r) {
        return query(1, 0, n - 1, l, r);
    }

    private int query(int node, int start, int end, int l, int r) {
        if (r < start || end < l) return 0; // Out of range
        if (l <= start && end <= r) return tree[node]; // Fully in range
        
        int mid = (start + end) / 2;
        return query(2 * node, start, mid, l, r) + query(2 * node + 1, mid + 1, end, l, r);
    }
}
```

---

## When to use Segment Tree vs. Fenwick Tree?

| Feature | Segment Tree | Fenwick Tree (BIT) |
|---|---|---|
| **Operations** | Range Sum, Min, Max, GCD | Mostly Prefix/Range Sum |
| **Space** | $O(4n)$ | $O(n)$ |
| **Complexity** | $O(\log n)$ | $O(\log n)$ |
| **Implementation** | More code, very flexible | Concise, limited to certain operations |

## Use Cases

1. **Range Minimum/Maximum Query (RMQ)**: Finding the smallest/largest element in a sub-array.
2. **Frequency Queries**: Counting occurrences of elements in a range.
3. **Computational Geometry**: Finding overlapping intervals.

## Summary

Segment Trees are the "Swiss Army Knife" of range-based problems. By organizing the array into a hierarchical tree of segments, they enable blazingly fast updates and queries on dynamic data. While the implementation is slightly longer than other structures, its flexibility makes it a powerful asset in any high-performance application.
