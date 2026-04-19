---
title: "Z-Algorithm in Java: Linear Time String Matching"
description: "Master the Z-Algorithm in Java. Learn how to find all occurrences of a pattern in a text in linear time using the Z-array, a powerful alternative to KMP."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "algorithms", "string matching", "z-algorithm", "interview preparation"]
featured: false
affiliateSection: "java-courses"
---

The **Z-Algorithm** is an efficient string matching algorithm that finds all occurrences of a pattern $P$ in a text $T$ in linear time $O(n + m)$.

While many developers learn KMP (Knuth-Morris-Pratt), the Z-Algorithm is often considered more intuitive because it relies on a single array—the **Z-array**—to store the longest common prefix between the string and its suffixes.

## The Core Concept: The Z-Array

For a string $S$, the Z-array $Z$ is an array where $Z[i]$ is the length of the longest common prefix between $S$ and the suffix of $S$ starting at index $i$.

To find a pattern $P$ in text $T$:
1. Create a concatenated string $S = P + "$" + T$ (where "$" is a character not present in $P$ or $T$).
2. Compute the Z-array for $S$.
3. Any index $i$ where $Z[i]$ equals the length of $P$ indicates a match!

---

## Z-Algorithm Implementation in Java

```java
public class ZAlgorithm {
    public int[] calculateZ(String s) {
        int n = s.length();
        int[] z = new int[n];
        int left = 0, right = 0;

        for (int i = 1; i < n; i++) {
            if (i <= right) {
                // If i is within the current [left, right] window, reuse previous values
                z[i] = Math.min(right - i + 1, z[i - left]);
            }
            
            // Try to expand the window manually
            while (i + z[i] < n && s.charAt(z[i]) == s.charAt(i + z[i])) {
                z[i]++;
            }

            // Update the window if we found a match that extends further right
            if (i + z[i] - 1 > right) {
                left = i;
                right = i + z[i] - 1;
            }
        }
        return z;
    }

    public void search(String text, String pattern) {
        String concat = pattern + "$" + text;
        int[] z = calculateZ(concat);
        int pLen = pattern.length();

        for (int i = 0; i < z.length; i++) {
            if (z[i] == pLen) {
                System.out.println("Pattern found at index " + (i - pLen - 1));
            }
        }
    }
}
```

---

## Z-Algorithm vs. KMP

| Feature | Z-Algorithm | KMP |
|---|---|---|
| **Data Structure** | Z-Array (Longest Common Prefix) | LPS Array (Longest Prefix Suffix) |
| **Search String** | $P + \$ + T$ | Uses $P$ to build table, then scans $T$ |
| **Complexity** | $O(n + m)$ | $O(n + m)$ |
| **Intuition** | Easier to visualize as "matching prefixes" | Involves "skipping" based on state machine |

## Why use the Z-Algorithm?

1. **Pattern Matching**: Find all occurrences of a string.
2. **String Compression**: Find the shortest period of a string.
3. **Prefix/Suffix Problems**: Quickly identify common parts of a string and its rotated versions.

## Summary

The Z-Algorithm is a powerful, linear-time tool for string manipulation. By using a sliding window to reuse previously calculated prefix information, it avoids redundant character comparisons. Its unified approach to pattern and text processing makes it a favorite for competitive programmers and a great "wow" factor in technical interviews.
