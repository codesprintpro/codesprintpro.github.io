---
title: "Suffix Arrays and Suffix Trees in Java: Advanced String Structures"
description: "Master Suffix Arrays and Suffix Trees in Java. Learn how these advanced structures enable O(m log n) substring searching and solve complex string problems in linear time."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "algorithms", "string", "suffix array", "suffix tree", "interview preparation"]
featured: false
affiliateSection: "java-courses"
---

When it comes to advanced string processing, **Suffix Trees** and **Suffix Arrays** are the heavy hitters. They allow you to answer complex queries about a string—like "What is the longest repeated substring?" or "How many times does pattern P appear?"—extremely fast.

While Suffix Trees are powerful, Suffix Arrays are often preferred in interviews and competitive programming because they are much more memory-efficient and easier to implement.

## 1. What is a Suffix Array?

A Suffix Array is simply a sorted array of all suffixes of a given string. Instead of storing the actual strings (which would be $O(n^2)$ space), we store the starting indices of the suffixes.

**Example for "banana$":**
1. Suffixes: `banana$`, `anana$`, `nana$`, `ana$`, `na$`, `a$`, `$`
2. Sorted Suffixes: `$`, `a$`, `ana$`, `anana$`, `banana$`, `na$`, `nana$`
3. Suffix Array: `[6, 5, 3, 1, 0, 4, 2]`

---

## 2. Suffix Array Implementation in Java (Simple $O(n^2 \log n)$)

A truly efficient Suffix Array construction takes $O(n \log n)$ or even $O(n)$, but the "simple" version is often enough to demonstrate the concept.

```java
import java.util.*;

public class SuffixArray {
    static class Suffix implements Comparable<Suffix> {
        int index;
        String text;

        Suffix(int index, String text) {
            this.index = index;
            this.text = text;
        }

        @Override
        public int compareTo(Suffix other) {
            return this.text.compareTo(other.text);
        }
    }

    public int[] buildSuffixArray(String s) {
        int n = s.length();
        Suffix[] suffixes = new Suffix[n];

        for (int i = 0; i < n; i++) {
            suffixes[i] = new Suffix(i, s.substring(i));
        }

        Arrays.sort(suffixes);

        int[] sa = new int[n];
        for (int i = 0; i < n; i++) {
            sa[i] = suffixes[i].index;
        }
        return sa;
    }
}
```

---

## 3. What is a Suffix Tree?

A Suffix Tree is a compressed Trie of all suffixes of a string. Every path from the root to a leaf represents a suffix.

**Why use a Suffix Tree?**
- Substring search: $O(m)$ time (where $m$ is pattern length).
- Find longest repeated substring: $O(n)$ time.
- Find longest common substring of two strings: $O(n + m)$ time.

## Suffix Array vs. Suffix Tree

| Feature | Suffix Tree | Suffix Array |
|---|---|---|
| **Space Complexity** | $O(n)$ but high constant | $O(n)$ (very compact) |
| **Construction Time** | $O(n)$ (Ukkonen's Algorithm) | $O(n \log n)$ or $O(n)$ |
| **Search Time** | $O(m)$ | $O(m \log n)$ (Binary Search) |
| **Complexity** | Hard to implement | Easier to implement |

## Summary

Suffix structures are the peak of string algorithmic design. While building a Suffix Tree from scratch is rarely required in a standard interview, understanding how a Suffix Array combined with an **LCP (Longest Common Prefix) Array** can solve almost any string problem is a hallmark of a senior-level algorithm engineer.
