---
title: "Dutch National Flag Pattern in Java: Efficient Three-Way Partitioning"
description: "Master the Dutch National Flag (DNF) pattern in Java for efficient in-place three-way partitioning of arrays. Learn its intuition, algorithm, dry runs, and complexity analysis for optimal solutions."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "dutch national flag", "arrays", "partitioning", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to the Dutch National Flag (DNF) Pattern

The **Dutch National Flag (DNF) pattern**, also known as three-way partitioning, is an algorithm for sorting an array containing three distinct values (or elements that can be grouped into three categories) in a single pass. It's particularly famous for its application in sorting an array of 0s, 1s, and 2s, but its principles extend to any problem requiring partitioning an array around a pivot into three sections: elements less than the pivot, elements equal to the pivot, and elements greater than the pivot.

This pattern is an in-place sorting algorithm, meaning it sorts the array without using extra space, making it highly memory-efficient. It's a classic example of a two-pointer (or three-pointer) approach that achieves linear time complexity.

## When Should You Think About the Dutch National Flag Pattern?

Consider the Dutch National Flag pattern when:

*   You are given an **array of elements**.
*   The elements can be classified into **three distinct categories** (e.g., 0s, 1s, 2s; or elements less than, equal to, or greater than a pivot).
*   You need to **sort or partition the array in-place** (without using extra space).
*   An `O(n)` time complexity solution is desired.

## Core Concept of the Dutch National Flag Pattern

The algorithm uses three pointers:

1.  `low`: Points to the end of the 
section containing elements smaller than the pivot (or 0s).
2.  `mid`: The current element being examined. It iterates through the array.
3.  `high`: Points to the beginning of the section containing elements greater than the pivot (or 2s).

The array is conceptually divided into four sections:

*   `arr[0...low-1]`: Elements smaller than the pivot (e.g., all 0s).
*   `arr[low...mid-1]`: Elements equal to the pivot (e.g., all 1s).
*   `arr[mid...high]`: Unsorted or unknown elements.
*   `arr[high+1...n-1]`: Elements greater than the pivot (e.g., all 2s).

The algorithm works by iterating `mid` from `low` to `high`. Based on the value of `arr[mid]`:

*   If `arr[mid]` is `0` (or less than pivot): Swap `arr[mid]` with `arr[low]`, then increment both `low` and `mid`.
*   If `arr[mid]` is `1` (or equal to pivot): Increment `mid`.
*   If `arr[mid]` is `2` (or greater than pivot): Swap `arr[mid]` with `arr[high]`, then decrement `high` (but `mid` remains the same, as the swapped element from `high` needs to be checked).

This process continues until `mid` crosses `high`.

## Example: Sorting an Array of 0s, 1s, and 2s

Given an array `nums` containing 0s, 1s, and 2s, sort them in-place so that 0s come first, then 1s, and then 2s.

#### Brute Force Approach

A simple approach would be to use any standard sorting algorithm like Merge Sort or Quick Sort, which would take `O(n log n)` time. Alternatively, counting the occurrences of 0s, 1s, and 2s and then overwriting the array would take `O(n)` time but require two passes.

```java
class Solution {
    public void sortColorsBruteForce(int[] nums) {
        // Using a standard sort (e.g., Arrays.sort in Java)
        java.util.Arrays.sort(nums);
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n log n)` for standard sorting algorithms.
*   **Space Complexity**: `O(log n)` or `O(n)` depending on the sorting algorithm (e.g., QuickSort uses `O(log n)` average stack space, MergeSort uses `O(n)` auxiliary space).

#### Optimized with Dutch National Flag Algorithm

```java
class Solution {
    public void sortColors(int[] nums) {
        if (nums == null || nums.length < 2) {
            return;
        }

        int low = 0;  // Pointer for 0s
        int mid = 0;  // Current element pointer
        int high = nums.length - 1; // Pointer for 2s

        while (mid <= high) {
            if (nums[mid] == 0) {
                // Swap nums[mid] with nums[low]
                swap(nums, low, mid);
                low++;
                mid++;
            } else if (nums[mid] == 1) {
                // Element is 1, just move mid pointer
                mid++;
            } else { // nums[mid] == 2
                // Swap nums[mid] with nums[high]
                swap(nums, mid, high);
                high--;
                // mid is not incremented because the swapped element from high
                // could be a 0 or 1 and needs to be re-evaluated.
            }
        }
    }

    private void swap(int[] arr, int i, int j) {
        int temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, as each element is visited and swapped at most a constant number of times.
*   **Space Complexity**: `O(1)`, as the sorting is done in-place.

### Dry Run: Sorting an Array of 0s, 1s, and 2s

**Input:** `nums = [2, 0, 2, 1, 1, 0]`

| `low` | `mid` | `high` | `nums[mid]` | Action                               | Array State             |
|-------|-------|--------|-------------|--------------------------------------|-------------------------|
| 0     | 0     | 5      | 2           | Swap `nums[0]` and `nums[5]`, `high--` | `[0, 0, 2, 1, 1, 2]`    |
| 0     | 0     | 4      | 0           | Swap `nums[0]` and `nums[0]`, `low++`, `mid++` | `[0, 0, 2, 1, 1, 2]`    |
| 1     | 1     | 4      | 0           | Swap `nums[1]` and `nums[1]`, `low++`, `mid++` | `[0, 0, 2, 1, 1, 2]`    |
| 2     | 2     | 4      | 2           | Swap `nums[2]` and `nums[4]`, `high--` | `[0, 0, 1, 1, 2, 2]`    |
| 2     | 2     | 3      | 1           | `mid++`                              | `[0, 0, 1, 1, 2, 2]`    |
| 2     | 3     | 3      | 1           | `mid++`                              | `[0, 0, 1, 1, 2, 2]`    |
| 2     | 4     | 3      | -           | `mid > high`, loop terminates        | `[0, 0, 1, 1, 2, 2]`    |

**Result:** `nums = [0, 0, 1, 1, 2, 2]`

## Reusable Template for Dutch National Flag Pattern

```java
class DutchNationalFlag {
    public void threeWayPartition(int[] nums, int pivot) {
        if (nums == null || nums.length < 2) {
            return;
        }

        int low = 0;
        int mid = 0;
        int high = nums.length - 1;

        while (mid <= high) {
            if (nums[mid] < pivot) {
                swap(nums, low, mid);
                low++;
                mid++;
            } else if (nums[mid] == pivot) {
                mid++;
            } else { // nums[mid] > pivot
                swap(nums, mid, high);
                high--;
            }
        }
    }

    private void swap(int[] arr, int i, int j) {
        int temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
    }
}
```

## How to Recognize the Dutch National Flag Pattern in Interviews

Look for these clues:

*   **Input**: An array of elements.
*   **Goal**: Partition or sort the array into **three distinct sections** based on a condition (e.g., less than, equal to, greater than a pivot; or specific values like 0, 1, 2).
*   **Constraint**: Often requires an **in-place** solution with **`O(1)` extra space**.
*   **Efficiency**: When an `O(n)` single-pass solution is desired for partitioning.

## Common Mistakes

### Mistake 1: Incorrectly moving `mid` pointer

When `nums[mid]` is swapped with `nums[high]` (because `nums[mid]` is greater than the pivot), `mid` should **not** be incremented. The element swapped from `high` into `mid`'s position is an unknown value and needs to be re-evaluated in the next iteration. Only `high` should be decremented.

### Mistake 2: Off-by-one errors in pointer boundaries

Ensure the `while (mid <= high)` condition is correctly handled. If `mid` goes beyond `high`, it means the unknown section has been fully processed.

### Mistake 3: Not handling edge cases

Consider arrays with fewer than two elements, or arrays where all elements are the same value.

## Dutch National Flag vs. QuickSort Partition

Both involve partitioning, but for different purposes:

*   **QuickSort Partition**: Typically partitions an array into two sections: elements less than or equal to a pivot, and elements greater than the pivot. It's a recursive algorithm used for general sorting.
*   **Dutch National Flag**: Specifically partitions into **three** sections. It's a single-pass, in-place algorithm often used when elements fall into distinct categories, providing a more optimized solution than QuickSort for such specific scenarios.

## Practice Problems for This Pattern

1.  **Sort Colors** (LeetCode 75) - The classic problem.
2.  **Partition Array According to Given Pivot** (LeetCode 2161) - A variation where you partition around a given pivot.
3.  **Wiggle Sort II** (LeetCode 324) - Can involve partitioning ideas.

## Interview Script You Can Reuse

```text
"This problem requires partitioning the array into three distinct groups (e.g., 0s, 1s, and 2s) in-place. I can use the Dutch National Flag algorithm, which employs three pointers: `low` for the boundary of elements smaller than the pivot, `mid` for the current element being examined, and `high` for the boundary of elements greater than the pivot. As `mid` traverses the array, I'll swap elements to their correct sections. If `nums[mid]` is less than the pivot, I swap it with `nums[low]` and increment both `low` and `mid`. If `nums[mid]` is equal to the pivot, I just increment `mid`. If `nums[mid]` is greater than the pivot, I swap it with `nums[high]` and decrement `high`, but `mid` remains in place to re-evaluate the newly swapped element. This approach achieves an optimal O(n) time complexity with O(1) space."
```

## Final Takeaways

*   **Dutch National Flag** is an efficient **three-way partitioning** algorithm.
*   It sorts elements into three categories (e.g., 0s, 1s, 2s) in a **single pass**.
*   Achieves **`O(n)` time complexity** and **`O(1)` space complexity** (in-place).
*   Uses **three pointers** (`low`, `mid`, `high`) to manage partitions.
*   Crucial for problems requiring **in-place sorting of categorized elements**.

Mastering the Dutch National Flag pattern is valuable for optimizing array manipulation problems and demonstrating a strong understanding of in-place algorithms.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
*   [Kadane’s Algorithm in Java](/blog/kadanes-algorithm-java/)
*   [Prefix Sum Pattern in Java](/blog/prefix-sum-pattern-java/)
*   [Sliding Window Pattern in Java](/blog/sliding-window-pattern-java/)
*   [Two Pointers Pattern in Java](/blog/two-pointers-pattern-java/)
*   [Big-O Notation in Java](/blog/big-o-notation-java-interview-problem-solving/)
