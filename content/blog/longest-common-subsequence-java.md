---
title: "Longest Common Subsequence (LCS) in Java: Dynamic Programming Guide"
description: "Master the Longest Common Subsequence (LCS) problem in Java. Learn the recursive approach with memoization and the optimized bottom-up tabulation method."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "algorithms", "lcs", "dynamic programming", "strings", "interview preparation"]
featured: false
affiliateSection: "java-courses"
---

The **Longest Common Subsequence (LCS)** problem is a foundation of many string comparison tools, including `git diff` and bioinformatics software. A subsequence is a sequence that appears in the same relative order, but not necessarily contiguously.

For example, the LCS of "ABCDE" and "ACE" is "ACE", with a length of 3.

## The Recursive Decision Tree

When comparing two characters at indices `i` and `j`:
1. If they match: The LCS length is $1 + LCS(i+1, j+1)$.
2. If they don't match: You have two choices:
   - Skip the character in the first string: $LCS(i+1, j)$.
   - Skip the character in the second string: $LCS(i, j+1)$.
   - Take the maximum of these two.

---

## LCS Implementation in Java (Tabulation)

While recursion with memoization works, bottom-up tabulation is the standard for interviews due to its iterative nature and $O(1)$ stack usage.

```java
public class LongestCommonSubsequence {
    public int longestCommonSubsequence(String text1, String text2) {
        int m = text1.length();
        int n = text2.length();
        
        // dp[i][j] stores the LCS of text1[0...i-1] and text2[0...j-1]
        int[][] dp = new int[m + 1][n + 1];

        for (int i = 1; i <= m; i++) {
            for (int j = 1; j <= n; j++) {
                if (text1.charAt(i - 1) == text2.charAt(j - 1)) {
                    // Match! Add 1 to the previous diagonal result
                    dp[i][j] = 1 + dp[i - 1][j - 1];
                } else {
                    // No match. Take the maximum from top or left cells
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        return dp[m][n];
    }
}
```

---

## Space Optimization (Optional)

Since `dp[i][j]` only depends on the current row and the previous row, we can reduce the space complexity from $O(m \cdot n)$ to $O(\min(m, n))$ by using two rows instead of a full 2D matrix.

## Common Interview Variations

1. **Longest Common Substring**: Requires characters to be contiguous. (Change `else` logic to `dp[i][j] = 0`).
2. **Shortest Common Supersequence**: Find the shortest string that contains both as subsequences.
3. **Edit Distance**: Find the minimum number of operations (insert, delete, replace) to turn one string into another.

## Complexity Analysis

- **Time Complexity**: $O(m \cdot n)$ because we fill a matrix of size $m \times n$.
- **Space Complexity**: $O(m \cdot n)$ for the 2D array (or $O(n)$ with space optimization).

## Summary

LCS is the quintessential DP problem. It teaches you how to define a 2D state and how to make local decisions that lead to a global optimum. Understanding LCS makes other sequence alignment problems much easier to grasp.
