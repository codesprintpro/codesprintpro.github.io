---
title: "Monotonic Stack Pattern in Java: Efficiently Finding Next Greater/Smaller Elements"
description: "Master the Monotonic Stack pattern in Java for efficiently solving problems like Next Greater Element, Next Smaller Element, and related array/list challenges. Learn its intuition, algorithm, dry runs, and complexity analysis."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "monotonic stack", "stack", "arrays", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to the Monotonic Stack Pattern

The **Monotonic Stack pattern** is a specialized application of the stack data structure where the elements within the stack are always kept in a specific order (either strictly increasing or strictly decreasing). This property makes it incredibly useful for efficiently solving problems that involve finding the 
next greater element, next smaller element, or similar problems in an array or list.

By maintaining a monotonic order, the stack allows us to quickly determine the relevant elements (e.g., the first element greater than the current one) without having to scan through large portions of the array repeatedly. This often reduces the time complexity from `O(n^2)` to `O(n)`.

## When Should You Think About Monotonic Stack?

Consider the Monotonic Stack pattern when:

*   You are given an **array or list**.
*   You need to find the **next greater/smaller element** for each element.
*   You need to find the **previous greater/smaller element** for each element.
*   You are looking for the **span** (e.g., number of consecutive elements smaller than or equal to the current element).
*   Problems involve **subarrays or ranges** where elements need to be compared with their neighbors in a specific order.
*   A brute-force solution involves **nested loops** to find the next/previous element, leading to `O(n^2)` complexity.

## Core Concept of Monotonic Stack

A monotonic stack (either increasing or decreasing) ensures that elements are pushed and popped in such a way that the stack always maintains its monotonic property. This property is key to its efficiency.

### Monotonically Increasing Stack

In a monotonically increasing stack, elements are pushed such that the top of the stack is always the largest element. If a new element is smaller than the top, elements are popped until the stack top is smaller than or equal to the new element, or the stack becomes empty. This is useful for finding the **next smaller element** or **previous greater element**.

### Monotonically Decreasing Stack

In a monotonically decreasing stack, elements are pushed such that the top of the stack is always the smallest element. If a new element is larger than the top, elements are popped until the stack top is larger than or equal to the new element, or the stack becomes empty. This is useful for finding the **next greater element** or **previous smaller element**.

## Example: Next Greater Element I

The **Next Greater Element** of some element `x` in an array is the first element to its right that is strictly greater than `x`. If no such element exists, consider the next greater element as `-1`.

Given two distinct 0-indexed integer arrays `nums1` and `nums2`, where `nums1` is a subset of `nums2`, find the next greater element for each element in `nums1` in `nums2`.

#### Brute Force Approach

A naive approach would be to iterate through `nums1`, and for each element, find its position in `nums2`, then iterate to its right to find the next greater element.

```java
import java.util.HashMap;
import java.util.Map;

class Solution {
    public int[] nextGreaterElementBruteForce(int[] nums1, int[] nums2) {
        int[] result = new int[nums1.length];
        Map<Integer, Integer> num2IndexMap = new HashMap<>();
        for (int i = 0; i < nums2.length; i++) {
            num2IndexMap.put(nums2[i], i);
        }

        for (int i = 0; i < nums1.length; i++) {
            int findNum = nums1[i];
            int startIndex = num2IndexMap.get(findNum);
            int nextGreater = -1;
            for (int j = startIndex + 1; j < nums2.length; j++) {
                if (nums2[j] > findNum) {
                    nextGreater = nums2[j];
                    break;
                }
            }
            result[i] = nextGreater;
        }
        return result;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(nums1.length * nums2.length)` in the worst case, as for each element in `nums1`, we might scan a significant portion of `nums2`.
*   **Space Complexity**: `O(nums2.length)` for the hash map.

#### Optimized with Monotonic Stack

We can use a monotonically decreasing stack to find the next greater element for all elements in `nums2` in a single pass. We also use a hash map to store the results for quick lookup.

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Stack;

class Solution {
    public int[] nextGreaterElement(int[] nums1, int[] nums2) {
        Map<Integer, Integer> nextGreaterMap = new HashMap<>(); // Stores {element -> next greater element}
        Stack<Integer> stack = new Stack<>(); // Monotonically decreasing stack

        for (int num : nums2) {
            // While stack is not empty and current num is greater than stack top
            while (!stack.isEmpty() && num > stack.peek()) {
                nextGreaterMap.put(stack.pop(), num); // Pop and record next greater element
            }
            stack.push(num); // Push current num onto stack
        }

        // Any elements remaining in the stack have no next greater element
        while (!stack.isEmpty()) {
            nextGreaterMap.put(stack.pop(), -1);
        }

        int[] result = new int[nums1.length];
        for (int i = 0; i < nums1.length; i++) {
            result[i] = nextGreaterMap.get(nums1[i]);
        }
        return result;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(nums1.length + nums2.length)`. Each element in `nums2` is pushed and popped from the stack at most once. Building the `nextGreaterMap` takes `O(nums2.length)`, and looking up results for `nums1` takes `O(nums1.length)`.
*   **Space Complexity**: `O(nums2.length)` for the `nextGreaterMap` and the stack in the worst case.

### Dry Run: Next Greater Element I

**Input:** `nums1 = [4, 1, 2]`, `nums2 = [1, 3, 4, 2]`

| `num` (from `nums2`) | Stack (bottom to top) | `nextGreaterMap` | Notes |
|----------------------|-----------------------|------------------|-------|
| -                    | []                    | {}               | Initialize |
| 1                    | [1]                   | {}               | Push 1 |
| 3                    | [3]                   | {1: 3}           | Pop 1 (3 > 1), Push 3 |
| 4                    | [4]                   | {1: 3, 3: 4}     | Pop 3 (4 > 3), Push 4 |
| 2                    | [4, 2]                | {1: 3, 3: 4}     | 2 < 4, Push 2 |
| **End of `nums2`**   | [4, 2]                | {1: 3, 3: 4}     |       |
| **Process remaining stack** | []                    | {1: 3, 3: 4, 2: -1, 4: -1} | Pop 2, 4 (no greater elements) |

**Result for `nums1`:**

*   `nums1[0] = 4`: `nextGreaterMap.get(4) = -1`
*   `nums1[1] = 1`: `nextGreaterMap.get(1) = 3`
*   `nums1[2] = 2`: `nextGreaterMap.get(2) = -1`

Final `result = [-1, 3, -1]`

## Reusable Template for Monotonic Stack

```java
import java.util.Stack;

class MonotonicStackTemplate {

    // Template for finding Next Greater Element (NGE) for all elements in an array
    // Returns an array where result[i] is the NGE for nums[i]
    public int[] findNextGreaterElements(int[] nums) {
        int n = nums.length;
        int[] result = new int[n];
        Stack<Integer> stack = new Stack<>(); // Stores indices, maintaining nums[stack.peek()] in decreasing order

        for (int i = n - 1; i >= 0; i--) { // Iterate from right to left
            // Pop elements from stack that are less than or equal to current element
            while (!stack.isEmpty() && nums[stack.peek()] <= nums[i]) {
                stack.pop();
            }
            // If stack is empty, no NGE. Otherwise, stack.peek() is the NGE
            result[i] = stack.isEmpty() ? -1 : nums[stack.peek()];
            stack.push(i); // Push current element's index onto stack
        }
        return result;
    }

    // Template for finding Next Smaller Element (NSE) for all elements in an array
    // Returns an array where result[i] is the NSE for nums[i]
    public int[] findNextSmallerElements(int[] nums) {
        int n = nums.length;
        int[] result = new int[n];
        Stack<Integer> stack = new Stack<>(); // Stores indices, maintaining nums[stack.peek()] in increasing order

        for (int i = n - 1; i >= 0; i--) { // Iterate from right to left
            // Pop elements from stack that are greater than or equal to current element
            while (!stack.isEmpty() && nums[stack.peek()] >= nums[i]) {
                stack.pop();
            }
            // If stack is empty, no NSE. Otherwise, stack.peek() is the NSE
            result[i] = stack.isEmpty() ? -1 : nums[stack.peek()];
            stack.push(i); // Push current element's index onto stack
        }
        return result;
    }
}
```

## How to Recognize Monotonic Stack in Interviews

Look for these clues:

*   **Input**: Array or list of numbers.
*   **Goal**: Find the **next/previous greater/smaller element** for each element.
*   **Keywords**: "Next greater element", "next smaller element", "previous greater element", "previous smaller element", "span", "histogram largest rectangle".
*   **Efficiency**: When a brute-force `O(n^2)` solution needs to be optimized to `O(n)`.

## Common Mistakes

### Mistake 1: Incorrect Monotonicity

Ensure you are maintaining the correct monotonic order (increasing or decreasing) in the stack based on whether you need to find greater or smaller elements. A decreasing stack is for finding the next greater element, and an increasing stack is for finding the next smaller element.

### Mistake 2: Incorrectly Storing Elements/Indices

Decide whether to store the actual elements or their indices in the stack. Storing indices is often more flexible, especially when you need to calculate distances or use the original index.

### Mistake 3: Off-by-one Errors or Edge Cases

Properly handle empty stacks and the elements remaining in the stack after the main loop (they typically have no next greater/smaller element).

## Monotonic Stack vs. Other Stack Applications

*   **General Stack**: Used for LIFO operations, function call management, expression evaluation, and backtracking.
*   **Monotonic Stack**: A specialized stack that maintains a specific order among its elements, making it efficient for finding nearest greater/smaller elements.

## Practice Problems for This Pattern

1.  **Next Greater Element I** (LeetCode 496) - The classic problem.
2.  **Next Greater Element II** (LeetCode 503) - Circular array variation.
3.  **Daily Temperatures** (LeetCode 739) - Find days until a warmer temperature.
4.  **Largest Rectangle in Histogram** (LeetCode 84) - A more complex application involving finding previous/next smaller elements.
5.  **Sum of Subarray Minimums** (LeetCode 907) - Another advanced application.

## Interview Script You Can Reuse

```text
"This problem asks for the next greater/smaller element for each item, which is a strong indicator for using a Monotonic Stack. I will use a stack to store elements (or their indices) in a monotonically decreasing/increasing order. As I iterate through the array, if the current element is greater/smaller than the top of the stack, I will pop elements from the stack and record the current element as their next greater/smaller element. Then, I will push the current element onto the stack. This approach ensures that each element is pushed and popped at most once, leading to an optimal O(n) time complexity and O(n) space complexity for the stack and result storage."
```

## Final Takeaways

*   **Monotonic Stack** efficiently finds **next/previous greater/smaller elements**.
*   Maintains elements in **strictly increasing or decreasing order**.
*   Achieves **`O(n)` time complexity** and **`O(n)` space complexity**.
*   Crucial for optimizing problems that involve **neighbor comparisons**.

Mastering the Monotonic Stack pattern is key to solving a class of problems that are otherwise `O(n^2)` efficiently.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
*   [Sorting Algorithms in Java](/blog/sorting-algorithms-java/)
*   [Binary Search Pattern in Java](/blog/binary-search-pattern-java/)
*   [In-place Reversal of a Linked List in Java](/blog/in-place-linked-list-reversal-java/)
*   [Fast & Slow Pointers in Java](/blog/fast-slow-pointers-java/)
*   [Dutch National Flag Pattern in Java](/blog/dutch-national-flag-pattern-java/)
*   [Kadane’s Algorithm in Java](/blog/kadanes-algorithm-java/)
*   [Prefix Sum Pattern in Java](/blog/prefix-sum-pattern-java/)
*   [Sliding Window Pattern in Java](/blog/sliding-window-pattern-java/)
*   [Two Pointers Pattern in Java](/blog/two-pointers-pattern-java/)
*   [Big-O Notation in Java](/blog/big-o-notation-java-interview-problem-solving/)
