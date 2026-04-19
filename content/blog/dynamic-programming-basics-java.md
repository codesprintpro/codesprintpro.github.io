---
title: "Dynamic Programming in Java: From Memoization to Tabulation"
description: "Master the fundamentals of Dynamic Programming (DP) in Java. Learn the 3-step process to solve DP problems, the difference between top-down and bottom-up, and common interview patterns."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "dynamic programming", "optimization", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

Dynamic Programming (DP) is often the most feared topic in technical interviews. However, it is fundamentally just an optimization over plain recursion.

If you have a problem that can be broken down into **overlapping subproblems** and has an **optimal substructure**, DP is your solution.

## The 3-Step Process to Solving any DP Problem

Don't try to write the final optimized solution immediately. Follow this path:

1. **Recursive (Brute Force)**: Define the recurrence relation.
2. **Memoization (Top-Down)**: Store the results of expensive recursive calls to avoid re-computation.
3. **Tabulation (Bottom-Up)**: Build the solution iteratively from the smallest subproblems up to the final answer.

---

## Example: The Fibonacci Sequence

### 1. The Recursive Way (Inefficient)
Time Complexity: $O(2^n)$

```java
public int fib(int n) {
    if (n <= 1) return n;
    return fib(n - 1) + fib(n - 2);
}
```

### 2. Memoization (Top-Down)
Time Complexity: $O(n)$ | Space: $O(n)$

```java
public int fib(int n) {
    return helper(n, new Integer[n + 1]);
}

private int helper(int n, Integer[] memo) {
    if (n <= 1) return n;
    if (memo[n] != null) return memo[n]; // Return cached result
    
    memo[n] = helper(n - 1, memo) + helper(n - 2, memo);
    return memo[n];
}
```

### 3. Tabulation (Bottom-Up)
Time Complexity: $O(n)$ | Space: $O(n)$

```java
public int fib(int n) {
    if (n <= 1) return n;
    int[] dp = new int[n + 1];
    dp[0] = 0;
    dp[1] = 1;
    
    for (int i = 2; i <= n; i++) {
        dp[i] = dp[i - 1] + dp[i - 2];
    }
    
    return dp[n];
}
```

---

## Common DP Patterns in Interviews

Once you understand the basic mechanics, most DP problems fall into a few common categories:

### 1. 0/1 Knapsack
You have items with weights and values. You need to fit the maximum value into a knapsack of capacity W.
- **Decision**: Take the item or leave it.

### 2. Longest Common Subsequence (LCS)
Find the longest sequence of characters that appears in both strings in the same order.
- **Decision**: If characters match, add 1. If not, take the max of skipping one char from either string.

### 3. Climbing Stairs / Fibonacci Style
How many ways to reach the $n^{th}$ step if you can take 1 or 2 steps?
- **Recurrence**: `dp[i] = dp[i-1] + dp[i-2]`

## Top-Down vs. Bottom-Up: Which to choose?

| Feature | Memoization (Top-Down) | Tabulation (Bottom-Up) |
|---|---|---|
| **Complexity** | Usually easier to reason from recursion | Harder to "see" the table logic initially |
| **Stack Space** | Uses recursion, can hit StackOverflow | No recursion, very memory efficient |
| **Execution** | Only computes required subproblems | Computes ALL subproblems in the table |

## Summary

Dynamic Programming is just **recursion with a memory**. Start by defining the smallest unit of the problem, write the recursive relation, and then add a cache (array or map) to make it performant. Mastery comes from recognizing the "decision" at each step.
