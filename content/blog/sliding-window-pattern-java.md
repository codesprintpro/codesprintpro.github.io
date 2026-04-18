---
title: "Sliding Window Pattern in Java: Efficiently Solve Array and String Subarray Problems"
description: "Master the sliding window pattern in Java for array and string problems. Learn fixed and variable-size windows, dry runs, and complexity analysis for optimal solutions."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "sliding window", "arrays", "strings", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to the Sliding Window Pattern

The **Sliding Window pattern** is a powerful technique used to solve problems that involve finding a subarray, subsegment, or substring in a given array or string that satisfies a certain condition. It's particularly useful for optimizing brute-force approaches that would otherwise involve nested loops, reducing time complexity from `O(n^2)` or `O(n^3)` to `O(n)`.

The core idea is to maintain a "window" (a contiguous range of elements) that slides over the data. This window can be of a fixed size or a variable size, depending on the problem. Instead of re-evaluating the entire subarray/substring for each position, the sliding window efficiently updates calculations by adding new elements to one end and removing old elements from the other.

## When Should You Think About Sliding Window?

Consider the sliding window pattern when:

*   You're dealing with **arrays or strings**.
*   You need to find a **contiguous subarray, subsegment, or substring**.
*   The problem asks for the **maximum, minimum, longest, or shortest** of something within that contiguous range.
*   A brute-force solution involves **nested loops** iterating over all possible subarrays/substrings.
*   You can **efficiently add/remove elements** from the window and update calculations in `O(1)` time.

## Core Concepts of Sliding Window

There are generally two types of sliding window problems:

1.  **Fixed-Size Sliding Window**: The window size `k` is constant throughout the traversal. You slide the window one element at a time, adding a new element and removing an old one.
2.  **Variable-Size Sliding Window**: The window size changes dynamically. You expand the window when a condition is not met and shrink it when the condition is met or exceeded, trying to find the optimal window.

Both approaches involve maintaining pointers (usually `left` and `right`) that define the boundaries of the current window.

## Pattern 1: Fixed-Size Sliding Window

This is the simpler form where the window size `k` is predetermined. The goal is often to find a property (e.g., sum, average, maximum) within every window of size `k`.

### Example: Maximum Sum Subarray of Size K

Given an array of positive numbers and a positive integer `k`, find the maximum sum of any contiguous subarray of size `k`.

#### Brute Force Approach

A naive approach would be to calculate the sum of every possible subarray of size `k`.

```java
class Solution {
    public int findMaxSumSubarrayBruteForce(int[] arr, int k) {
        int maxSum = 0;
        for (int i = 0; i <= arr.length - k; i++) {
            int currentWindowSum = 0;
            for (int j = i; j < i + k; j++) {
                currentWindowSum += arr[j];
            }
            maxSum = Math.max(maxSum, currentWindowSum);
        }
        return maxSum;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n*k)`, as for each of `n-k+1` subarrays, we iterate `k` times to find the sum.
*   **Space Complexity**: `O(1)`

#### Optimized with Fixed-Size Sliding Window

Instead of recalculating the sum for each window, we can subtract the element going out of the window and add the element coming into the window.

```java
class Solution {
    public int findMaxSumSubarray(int[] arr, int k) {
        if (k > arr.length) {
            throw new IllegalArgumentException("k cannot be greater than array length");
        }

        int windowSum = 0;
        int maxSum = 0;
        int windowStart = 0;

        // Calculate sum of the first window
        for (int i = 0; i < k; i++) {
            windowSum += arr[i];
        }
        maxSum = windowSum;

        // Slide the window
        for (int windowEnd = k; windowEnd < arr.length; windowEnd++) {
            windowSum += arr[windowEnd]; // Add the new element
            windowSum -= arr[windowStart]; // Subtract the element going out
            windowStart++; // Slide the window forward
            maxSum = Math.max(maxSum, windowSum);
        }

        return maxSum;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, as we iterate through the array only once.
*   **Space Complexity**: `O(1)`

### Dry Run: Maximum Sum Subarray of Size K

**Input:** `arr = [2, 1, 5, 1, 3, 2]`, `k = 3`

| `windowStart` | `windowEnd` | `arr[windowEnd]` | `windowSum` (before update) | `arr[windowStart]` (to remove) | `windowSum` (after update) | `maxSum` | Notes |
|---------------|-------------|------------------|-----------------------------|--------------------------------|----------------------------|----------|-------|
| -             | -           | -                | -                           | -                              | 0                          | 0        | Initialize |
| 0             | 0           | 2                | 0                           | -                              | 2                          | 0        | First element |
| 0             | 1           | 1                | 2                           | -                              | 3                          | 0        | Second element |
| 0             | 2           | 5                | 3                           | -                              | 8                          | 8        | First window sum (2+1+5) |
| 1             | 3           | 1                | 8                           | 2                              | 7                          | 8        | `windowSum = 8 - 2 + 1 = 7` (1+5+1) |
| 2             | 4           | 3                | 7                           | 1                              | 9                          | 9        | `windowSum = 7 - 1 + 3 = 9` (5+1+3) |
| 3             | 5           | 2                | 9                           | 3                              | 8                          | 9        | `windowSum = 9 - 3 + 2 = 8` (1+3+2) |

**Result:** `maxSum = 9`

## Pattern 2: Variable-Size Sliding Window

In this variation, the window size is not fixed. The goal is often to find the smallest, largest, or a specific window that satisfies a given condition. This usually involves expanding the window from the right and shrinking it from the left based on the condition.

### Example: Longest Substring with K Distinct Characters

Given a string, find the length of the longest substring in it with no more than `k` distinct characters.

#### Brute Force Approach

Iterate through all possible substrings and for each, count distinct characters. This would be `O(n^2 * n)` or `O(n^2)` with a hash map.

#### Optimized with Variable-Size Sliding Window

We expand the window to the right, adding characters to a frequency map. If the number of distinct characters exceeds `k`, we shrink the window from the left until the condition is met again.

```java
import java.util.HashMap;
import java.util.Map;

class Solution {
    public int findLongestSubstringWithKDistinct(String str, int k) {
        if (str == null || str.length() == 0 || k == 0) {
            return 0;
        }

        int windowStart = 0;
        int maxLength = 0;
        Map<Character, Integer> charFrequencyMap = new HashMap<>();

        // Extend the window to the right
        for (int windowEnd = 0; windowEnd < str.length(); windowEnd++) {
            char rightChar = str.charAt(windowEnd);
            charFrequencyMap.put(rightChar, charFrequencyMap.getOrDefault(rightChar, 0) + 1);

            // Shrink the window from the left if distinct characters > k
            while (charFrequencyMap.size() > k) {
                char leftChar = str.charAt(windowStart);
                charFrequencyMap.put(leftChar, charFrequencyMap.get(leftChar) - 1);
                if (charFrequencyMap.get(leftChar) == 0) {
                    charFrequencyMap.remove(leftChar);
                }
                windowStart++;
            }
            maxLength = Math.max(maxLength, windowEnd - windowStart + 1);
        }
        return maxLength;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, as `windowEnd` iterates through the string once, and `windowStart` also moves forward at most `n` times. Map operations take `O(1)` on average.
*   **Space Complexity**: `O(k)` or `O(alphabet_size)`, as the hash map stores at most `k` distinct characters.

### Dry Run: Longest Substring with K Distinct Characters

**Input:** `str = "araaci"`, `k = 2`

| `windowStart` | `windowEnd` | `rightChar` | `charFrequencyMap` | `charFrequencyMap.size()` | `maxLength` | Notes |
|---------------|-------------|-------------|--------------------|---------------------------|-------------|-------|
| 0             | 0           | 'a'         | {'a': 1}           | 1                         | 1           | Window: "a" |
| 0             | 1           | 'r'         | {'a': 1, 'r': 1}   | 2                         | 2           | Window: "ar" |
| 0             | 2           | 'a'         | {'a': 2, 'r': 1}   | 2                         | 3           | Window: "ara" |
| 0             | 3           | 'a'         | {'a': 3, 'r': 1}   | 2                         | 4           | Window: "araa" |
| 0             | 4           | 'c'         | {'a': 3, 'r': 1, 'c': 1} | 3 ( > k)                | 4           | Window: "araac" |
| 1             | 4           | 'c'         | {'a': 2, 'r': 1, 'c': 1} | 3 ( > k)                | 4           | Shrink: remove 'a'. Window: "raac" |
| 2             | 4           | 'c'         | {'a': 1, 'r': 1, 'c': 1} | 3 ( > k)                | 4           | Shrink: remove 'a'. Window: "aac" |
| 3             | 4           | 'c'         | {'r': 1, 'c': 1}   | 2                         | 4           | Shrink: remove 'a'. Window: "ac" |
| 3             | 5           | 'i'         | {'r': 1, 'c': 1, 'i': 1} | 3 ( > k)                | 4           | Window: "aci" |
| 4             | 5           | 'i'         | {'c': 1, 'i': 1}   | 2                         | 2           | Shrink: remove 'r'. Window: "ci" |

**Result:** `maxLength = 4` (from "araa")

## Reusable Template for Sliding Window

### Fixed-Size Window

```java
public int fixedSizeWindowTemplate(int[] arr, int k) {
    int windowSum = 0; // or other metric like product, count, etc.
    int result = 0; // or Integer.MIN_VALUE/MAX_VALUE for max/min problems
    int windowStart = 0;

    for (int windowEnd = 0; windowEndEnd < arr.length; windowEnd++) {
        // Add the current element to the window
        windowSum += arr[windowEnd];

        // If window has reached size k, process it
        if (windowEnd >= k - 1) {
            // Process the window (e.g., update result with windowSum)
            result = Math.max(result, windowSum);

            // Shrink the window from the left
            windowSum -= arr[windowStart];
            windowStart++;
        }
    }
    return result;
}
```

### Variable-Size Window

```java
import java.util.HashMap;
import java.util.Map;

public int variableSizeWindowTemplate(String str, int k) { // or int[] arr
    int windowStart = 0;
    int maxLength = 0; // or minLength = Integer.MAX_VALUE
    Map<Character, Integer> charFrequencyMap = new HashMap<>(); // or other data structure

    for (int windowEnd = 0; windowEnd < str.length(); windowEnd++) {
        char rightChar = str.charAt(windowEnd);
        // Add the rightChar to your data structure (e.g., frequency map)
        charFrequencyMap.put(rightChar, charFrequencyMap.getOrDefault(rightChar, 0) + 1);

        // Condition to shrink the window (e.g., while condition is violated)
        while (charFrequencyMap.size() > k) { // Example: more than k distinct characters
            char leftChar = str.charAt(windowStart);
            // Remove/decrement leftChar from your data structure
            charFrequencyMap.put(leftChar, charFrequencyMap.get(leftChar) - 1);
            if (charFrequencyMap.get(leftChar) == 0) {
                charFrequencyMap.remove(leftChar);
            }
            windowStart++;
        }
        // Update result after satisfying the condition
        maxLength = Math.max(maxLength, windowEnd - windowStart + 1);
    }
    return maxLength;
}
```

## How to Recognize Sliding Window in Interviews

Look for these clues:

*   **Input**: Array, List, or String.
*   **Output**: Single value (max, min, count) related to a subarray/substring.
*   **Keywords**: 
Contiguous subarray/substring, longest, shortest, maximum, minimum, exactly K, at most K, at least K.
*   **Constraints**: Often involves a fixed size `k` or a condition that dictates window expansion/contraction.
*   **Optimization**: When a brute-force `O(n^2)` or `O(n^3)` solution can be reduced to `O(n)` by avoiding redundant calculations.

## Common Mistakes

### Mistake 1: Incorrectly updating window state

Ensure that when an element leaves the window, its contribution is correctly subtracted or removed from your tracking data structure (e.g., sum, frequency map). Similarly, ensure new elements are correctly added.

### Mistake 2: Off-by-one errors in window size

For fixed-size windows, ensure the `windowEnd >= k - 1` condition (or equivalent) correctly identifies when the window has reached the desired size. For variable-size windows, ensure `windowEnd - windowStart + 1` accurately reflects the current window length.

### Mistake 3: Not handling edge cases

Consider empty arrays/strings, `k` being larger than the array/string length, or `k = 0`.

### Mistake 4: Confusing fixed and variable window logic

Fixed-size windows typically have a `for` loop for `windowEnd` and an `if` condition to process and shrink. Variable-size windows often have a `for` loop for `windowEnd` and a `while` loop for `windowStart` to shrink the window until a condition is met.

## Sliding Window vs. Two Pointers

While both patterns use two pointers (`left` and `right` or `windowStart` and `windowEnd`), there's a subtle distinction:

*   **Two Pointers**: Often used when the relative order of elements matters, or when you need to compare elements from two different parts of a sorted array (e.g., finding a pair with a target sum). The pointers might move independently or in a coordinated fashion, but not necessarily defining a contiguous 
window.
*   **Sliding Window**: Specifically deals with **contiguous subarrays or substrings**. The pointers (`windowStart` and `windowEnd`) always define a valid window, and the primary mechanism is to expand the window from the right and potentially shrink it from the left.

Think of Sliding Window as a specialized application of the Two Pointers technique for problems involving contiguous ranges.

## Practice Problems for This Pattern

To solidify your understanding, try solving these problems using the Sliding Window pattern:

1.  **Longest Substring Without Repeating Characters** (LeetCode 3)
2.  **Permutation in String** (LeetCode 567)
3.  **Minimum Window Substring** (LeetCode 76)
4.  **Fruit Into Baskets** (LeetCode 904)
5.  **Subarray Product Less Than K** (LeetCode 713)
6.  **Sliding Window Maximum** (LeetCode 239) - *This often involves a Deque (Monotonic Queue) for optimization.*

For each problem, focus on:

*   Identifying if it's a fixed or variable-size window problem.
*   Defining the `windowStart` and `windowEnd` pointers.
*   Determining the condition for expanding and shrinking the window.
*   Choosing the right data structure (e.g., HashMap for frequency counts).
*   Analyzing time and space complexity.

## Interview Script You Can Reuse

If you identify a problem solvable with the Sliding Window pattern, you can explain it like this:

```text
"This problem asks for a property within a contiguous subarray/substring, which suggests a sliding window approach. I'll use two pointers, `windowStart` and `windowEnd`, to define my current window. As `windowEnd` expands, I'll update my window's state (e.g., sum, character frequencies). If the window violates the problem's condition (e.g., too many distinct characters, sum exceeds a limit), I'll shrink it from `windowStart` until the condition is met again. This allows me to process the array/string in a single pass, achieving O(n) time complexity with O(1) or O(k) space complexity, where k is the maximum number of distinct elements or window size."
```

## Final Takeaways

*   **Sliding Window** is an optimization technique for problems on contiguous subarrays/substrings.
*   It reduces complexity from `O(n^2)` or `O(n^3)` to `O(n)`.
*   Distinguish between **fixed-size** and **variable-size** windows.
*   Always maintain the window's state efficiently (e.g., sum, frequency map).
*   Clearly define the conditions for **expanding** (`windowEnd++`) and **shrinking** (`windowStart++`) the window.
*   It's a specialized form of the **Two Pointers** pattern.

Mastering the Sliding Window pattern is crucial for many interview questions and efficient algorithm design. It's a testament to how a simple idea can lead to significant performance improvements.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
*   [Two Pointers Pattern in Java](/blog/two-pointers-pattern-java/)
*   [Big-O Notation in Java](/blog/big-o-notation-java-interview-problem-solving/)
