---
title: "Fenwick Trees (Binary Indexed Trees) in Java"
description: "Learn how to implement a Fenwick Tree in Java. Discover the power of Binary Indexed Trees (BIT) for efficient prefix sum queries and point updates in logarithmic time."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "fenwick tree", "bit", "range query", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

The **Fenwick Tree**, also known as a **Binary Indexed Tree (BIT)**, is a compact data structure that provides efficient methods for calculation and manipulation of the prefix sums of an array of values.

It is more space-efficient and often easier to implement than a Segment Tree, though it is primarily restricted to "cumulative" operations like sum.

## The Core Concept: Powers of Two

A Fenwick Tree stores sums of ranges. The length of these ranges is determined by the powers of two. The "magic" of BIT comes from the expression `i & -i`, which gives the greatest power of two that divides `i`.

- **To update**: We move up the tree by adding `i & -i`.
- **To query (prefix sum)**: We move down the tree by subtracting `i & -i`.

---

## Fenwick Tree Implementation in Java

```java
public class FenwickTree {
    private int[] tree;
    private int n;

    public FenwickTree(int n) {
        this.n = n;
        this.tree = new int[n + 1]; // 1-based indexing
    }

    // Add 'val' to the element at index 'i'
    public void update(int i, int val) {
        i++; // Convert to 1-based index
        while (i <= n) {
            tree[i] += val;
            i += i & -i; // Move to parent
        }
    }

    // Get the sum from index 0 to 'i'
    public int query(int i) {
        i++; // Convert to 1-based index
        int sum = 0;
        while (i > 0) {
            sum += tree[i];
            i -= i & -i; // Move to parent
        }
        return sum;
    }

    // Get range sum from 'l' to 'r'
    public int queryRange(int l, int r) {
        return query(r) - query(l - 1);
    }
}
```

---

## Segment Tree vs. Fenwick Tree

| Feature | Fenwick Tree | Segment Tree |
|---|---|---|
| **Space** | $O(n)$ | $O(4n)$ |
| **Code Length** | Very Short | Long |
| **Complexity** | $O(\log n)$ | $O(\log n)$ |
| **Flexibility** | Mostly Sum/Count | Sum, Min, Max, GCD, etc. |

## Use Cases

1. **Inversion Counting**: Counting how many pairs $(i, j)$ exist such that $i < j$ and $arr[i] > arr[j]$.
2. **Dynamic Frequency Tracking**: Updating counts of elements and querying rank or range frequency.
3. **2D Queries**: Fenwick Trees can be extended to 2D for grid-based prefix sums.

## Summary

The Fenwick Tree is a beautiful example of using binary properties to optimize range operations. Its minimal space overhead and blazingly fast execution make it a favorite for competitive programming and high-performance financial systems. While it may not be as flexible as a Segment Tree, its simplicity makes it much harder to get wrong during a high-pressure coding interview.
