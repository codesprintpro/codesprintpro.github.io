---
title: "Rabin-Karp Algorithm in Java: Efficient String Searching with Hashing"
description: "Master the Rabin-Karp algorithm in Java. Learn how to use rolling hashes to find a pattern in a text in average linear time, and how to handle hash collisions effectively."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "algorithms", "string matching", "hashing", "rabin-karp", "interview preparation"]
featured: false
affiliateSection: "java-courses"
---

The **Rabin-Karp algorithm** is a powerful string searching algorithm that uses **hashing** to find any one of a set of pattern strings in a text.

While brute-force matching takes $O(n \cdot m)$ time, Rabin-Karp achieves an average time complexity of **$O(n + m)$** by comparing the hash value of the pattern with the hash values of all possible substrings of the text.

## The Core Concept: Rolling Hash

Comparing two strings character-by-character is slow. Comparing two hash values (integers) is fast.

**The Logic**:
1. Calculate the hash of the pattern $P$.
2. Calculate the hash of the first substring of length $m$ in text $T$.
3. If hashes match, perform a character-by-character check to avoid "False Positives" (collisions).
4. Slide the window by one character and **recompute the hash efficiently** using the previous hash value (Rolling Hash).

---

## Rabin-Karp Implementation in Java

```java
public class RabinKarp {
    private final int d = 256; // Number of characters in the input alphabet
    private final int q = 101; // A prime number for modulo operations

    public void search(String pattern, String text) {
        int m = pattern.length();
        int n = text.length();
        int p = 0; // hash value for pattern
        int t = 0; // hash value for text
        int h = 1;

        // The value of h would be "pow(d, m-1) % q"
        for (int i = 0; i < m - 1; i++)
            h = (h * d) % q;

        // Calculate the initial hash value of pattern and first window of text
        for (int i = 0; i < m; i++) {
            p = (d * p + pattern.charAt(i)) % q;
            t = (d * t + text.charAt(i)) % q;
        }

        // Slide the pattern over text one by one
        for (int i = 0; i <= n - m; i++) {
            // Check if the hash values match
            if (p == t) {
                // If hashes match, check for characters one by one
                int j;
                for (j = 0; j < m; j++) {
                    if (text.charAt(i + j) != pattern.charAt(j)) break;
                }
                if (j == m) System.out.println("Pattern found at index " + i);
            }

            // Calculate hash value for next window of text: Remove leading digit, add trailing digit
            if (i < n - m) {
                t = (d * (t - text.charAt(i) * h) + text.charAt(i + m)) % q;

                // We might get negative value of t, converting it to positive
                if (t < 0) t = (t + q);
            }
        }
    }
}
```

---

## Why use Rabin-Karp?

| Feature | Rabin-Karp | KMP / Z-Algorithm |
|---|---|---|
| **Multiple Patterns** | Excellent (Can use multiple hashes) | Better for single pattern |
| **Average Complexity** | $O(n + m)$ | $O(n + m)$ |
| **Worst Case** | $O(n \cdot m)$ (due to collisions) | $O(n + m)$ guaranteed |
| **Memory** | Very Low | Requires auxiliary tables ($O(m)$) |

## Rolling Hash Intuition

Imagine the string "12345" as a decimal number. If the window is "123" and you want to slide it to "234":
- Subtract $100 \times 1$ (Remove 1) $\rightarrow$ 23
- Multiply by 10 (Shift left) $\rightarrow$ 230
- Add 4 (Add 4) $\rightarrow$ 234

This allows us to compute the next hash in **$O(1)$** time!

## Summary

The Rabin-Karp algorithm is a clever combination of numerical intuition and string processing. Its use of rolling hashes makes it particularly useful for detecting plagiarism or searching for multiple patterns simultaneously. While its worst-case performance can suffer from collisions, its average-case speed and low memory footprint make it a favorite in large-scale text analysis systems.
