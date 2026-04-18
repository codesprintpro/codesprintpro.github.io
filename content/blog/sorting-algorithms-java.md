---
title: "Sorting Algorithms in Java: QuickSort, MergeSort, and HeapSort Explained"
description: "Master fundamental sorting algorithms in Java: QuickSort, MergeSort, and HeapSort. Learn their intuition, implementation, complexity analysis, and when to use each for optimal performance."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "sorting algorithms", "quicksort", "mergesort", "heapsort", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to Sorting Algorithms

Sorting is one of the most fundamental and widely studied problems in computer science. It involves arranging elements of a list or array in a specific order (e.g., numerical, lexicographical). Efficient sorting algorithms are crucial for optimizing other algorithms that rely on sorted data, such as binary search, and for improving data retrieval and processing speeds.

This article will delve into three powerful comparison-based sorting algorithms: **QuickSort**, **MergeSort**, and **HeapSort**. Each offers unique characteristics in terms of performance, space complexity, and stability, making them suitable for different scenarios.

## When Should You Think About Sorting Algorithms?

Consider applying sorting algorithms when:

*   You need to arrange data in a specific order for easier processing or presentation.
*   Subsequent operations (like searching, merging, or finding duplicates) require sorted input.
*   The problem involves finding `k`-th smallest/largest elements, ranges, or order statistics.
*   You need to understand the trade-offs between time complexity, space complexity, and stability for different sorting needs.

## Core Concepts of Sorting Algorithms

Sorting algorithms are typically evaluated based on:

*   **Time Complexity**: How the execution time grows with the input size `n`.
*   **Space Complexity**: How much auxiliary space the algorithm requires.
*   **Stability**: A sorting algorithm is stable if it preserves the relative order of equal elements.
*   **In-place**: An algorithm is in-place if it sorts the data within the original array structure, using minimal extra space.

### 1. QuickSort

QuickSort is a highly efficient, comparison-based, in-place sorting algorithm. It employs a **divide-and-conquer** strategy:

1.  **Pick a Pivot**: Choose an element from the array, called the pivot.
2.  **Partition**: Rearrange the array such that all elements smaller than the pivot come before it, and all elements greater than the pivot come after it. Elements equal to the pivot can go on either side. After partitioning, the pivot is in its final sorted position.
3.  **Recurse**: Recursively apply the above steps to the sub-arrays of elements smaller than the pivot and elements greater than the pivot.

Its average-case time complexity is `O(n log n)`, but its worst-case is `O(n^2)`, which can be mitigated by choosing a good pivot (e.g., random pivot, median-of-three).

#### Example: QuickSort Implementation

```java
class QuickSort {
    public void sort(int[] arr) {
        if (arr == null || arr.length == 0) {
            return;
        }
        quickSort(arr, 0, arr.length - 1);
    }

    private void quickSort(int[] arr, int low, int high) {
        if (low < high) {
            int pi = partition(arr, low, high);
            quickSort(arr, low, pi - 1);
            quickSort(arr, pi + 1, high);
        }
    }

    private int partition(int[] arr, int low, int high) {
        int pivot = arr[high]; // Choosing the last element as pivot
        int i = (low - 1); // Index of smaller element

        for (int j = low; j < high; j++) {
            if (arr[j] <= pivot) {
                i++;
                swap(arr, i, j);
            }
        }
        swap(arr, i + 1, high);
        return i + 1;
    }

    private void swap(int[] arr, int i, int j) {
        int temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
    }
}
```

**Complexity:**

*   **Time Complexity**: Average `O(n log n)`, Worst `O(n^2)`.
*   **Space Complexity**: `O(log n)` (average, for recursion stack), `O(n)` (worst, for recursion stack).
*   **Stability**: Not stable.
*   **In-place**: Yes.

### Dry Run: QuickSort

**Input:** `arr = [10, 7, 8, 9, 1, 5]`

1.  **Initial Call**: `quickSort(arr, 0, 5)`
    *   `pivot = arr[5] = 5`
    *   **Partition**: `[10, 7, 8, 9, 1, 5]`
        *   `i = -1`
        *   `j = 0, arr[0]=10 > 5`
        *   `j = 1, arr[1]=7 > 5`
        *   `j = 2, arr[2]=8 > 5`
        *   `j = 3, arr[3]=9 > 5`
        *   `j = 4, arr[4]=1 <= 5`: `i=0`, swap `arr[0]` (10) and `arr[4]` (1) -> `[1, 7, 8, 9, 10, 5]`
        *   Swap `arr[i+1]` (7) and `arr[high]` (5) -> `[1, 5, 8, 9, 10, 7]`
        *   `pi = 1` (pivot 5 is at index 1)
    *   **Result after partition**: `[1, 5, 8, 9, 10, 7]`
    *   **Recursive Calls**: `quickSort(arr, 0, 0)` (sort `[1]`), `quickSort(arr, 2, 5)` (sort `[8, 9, 10, 7]`)

This process continues recursively until all sub-arrays are sorted.

### 2. MergeSort

MergeSort is a stable, comparison-based sorting algorithm that also follows the **divide-and-conquer** paradigm. It guarantees `O(n log n)` time complexity in all cases.

1.  **Divide**: Divide the unsorted list into `n` sublists, each containing one element (a list of one element is considered sorted).
2.  **Conquer (Merge)**: Repeatedly merge sublists to produce new sorted sublists until there is only one sorted list remaining.

The key operation is the **merge** step, where two sorted sub-arrays are combined into a single sorted array.

#### Example: MergeSort Implementation

```java
class MergeSort {
    public void sort(int[] arr) {
        if (arr == null || arr.length < 2) {
            return;
        }
        mergeSort(arr, 0, arr.length - 1);
    }

    private void mergeSort(int[] arr, int left, int right) {
        if (left < right) {
            int mid = left + (right - left) / 2;
            mergeSort(arr, left, mid);
            mergeSort(arr, mid + 1, right);
            merge(arr, left, mid, right);
        }
    }

    private void merge(int[] arr, int left, int mid, int right) {
        int n1 = mid - left + 1;
        int n2 = right - mid;

        int[] L = new int[n1];
        int[] R = new int[n2];

        for (int i = 0; i < n1; i++) {
            L[i] = arr[left + i];
        }
        for (int j = 0; j < n2; j++) {
            R[j] = arr[mid + 1 + j];
        }

        int i = 0, j = 0;
        int k = left;
        while (i < n1 && j < n2) {
            if (L[i] <= R[j]) {
                arr[k] = L[i];
                i++;
            } else {
                arr[k] = R[j];
                j++;
            }
            k++;
        }

        while (i < n1) {
            arr[k] = L[i];
            i++;
            k++;
        }

        while (j < n2) {
            arr[k] = R[j];
            j++;
            k++;
        }
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n log n)` in all cases (best, average, worst).
*   **Space Complexity**: `O(n)` (for temporary arrays used in merging).
*   **Stability**: Stable.
*   **In-place**: No (requires auxiliary space).

### Dry Run: MergeSort

**Input:** `arr = [38, 27, 43, 3, 9, 82, 10]`

1.  **Divide**: The array is recursively split until individual elements.
    `[38, 27, 43, 3, 9, 82, 10]`
    `[38, 27, 43], [3, 9, 82, 10]`
    `[38], [27, 43], [3], [9, 82, 10]`
    ... down to single elements.

2.  **Merge**: Sorted sub-arrays are merged.
    `[27, 38, 43], [3, 9, 10, 82]`
    `[3, 9, 10, 27, 38, 43, 82]`

### 3. HeapSort

HeapSort is a comparison-based sorting algorithm that uses a **binary heap** data structure. It is an in-place algorithm with `O(n log n)` time complexity in all cases.

1.  **Build Max-Heap**: Transform the input array into a max-heap. In a max-heap, the value of each node is greater than or equal to the value of its children, and the largest element is at the root.
2.  **Extract Elements**: Repeatedly extract the maximum element from the heap (which is always the root), and place it at the end of the sorted portion of the array. After extracting, rebuild the heap with the remaining elements.

#### Example: HeapSort Implementation

```java
class HeapSort {
    public void sort(int[] arr) {
        if (arr == null || arr.length < 2) {
            return;
        }

        int n = arr.length;

        // Build max-heap (rearrange array)
        for (int i = n / 2 - 1; i >= 0; i--) {
            heapify(arr, n, i);
        }

        // One by one extract an element from heap
        for (int i = n - 1; i > 0; i--) {
            // Move current root to end
            int temp = arr[0];
            arr[0] = arr[i];
            arr[i] = temp;

            // call max heapify on the reduced heap
            heapify(arr, i, 0);
        }
    }

    // To heapify a subtree rooted with node i which is an index in arr[].
    // n is size of heap
    private void heapify(int[] arr, int n, int i) {
        int largest = i; // Initialize largest as root
        int left = 2 * i + 1; // left child
        int right = 2 * i + 2; // right child

        // If left child is larger than root
        if (left < n && arr[left] > arr[largest]) {
            largest = left;
        }

        // If right child is larger than largest so far
        if (right < n && arr[right] > arr[largest]) {
            largest = right;
        }

        // If largest is not root
        if (largest != i) {
            int swap = arr[i];
            arr[i] = arr[largest];
            arr[largest] = swap;

            // Recursively heapify the affected sub-tree
            heapify(arr, n, largest);
        }
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n log n)` in all cases (best, average, worst).
*   **Space Complexity**: `O(1)` (in-place).
*   **Stability**: Not stable.
*   **In-place**: Yes.

### Dry Run: HeapSort

**Input:** `arr = [12, 11, 13, 5, 6, 7]`

1.  **Build Max-Heap**: The array is transformed into a max-heap.
    *   Initial: `[12, 11, 13, 5, 6, 7]`
    *   After heapify: `[13, 11, 12, 5, 6, 7]` (example intermediate state)

2.  **Extract Elements**: Largest element (root) is swapped with the last element, and heap is rebuilt.
    *   Swap 13 and 7: `[7, 11, 12, 5, 6, 13]` (13 is sorted)
    *   Heapify `[7, 11, 12, 5, 6]` -> `[12, 11, 7, 5, 6]`
    *   Swap 12 and 6: `[6, 11, 7, 5, 12]` (12 is sorted)
    *   ... and so on until sorted.

## Comparison of QuickSort, MergeSort, and HeapSort

| Feature           | QuickSort             | MergeSort             | HeapSort              |
|-------------------|-----------------------|-----------------------|-----------------------|
| **Time Complexity** | `O(n log n)` (Avg)    | `O(n log n)` (All)    | `O(n log n)` (All)    |
|                   | `O(n^2)` (Worst)      |                       |                       |
| **Space Complexity**| `O(log n)` (Avg)      | `O(n)`                | `O(1)`                |
|                   | `O(n)` (Worst)        |                       |                       |
| **Stability**     | No                    | Yes                   | No                    |
| **In-place**      | Yes                   | No                    | Yes                   |
| **Use Cases**     | General-purpose, often fastest in practice, good for large datasets. | External sorting, linked lists, guarantees `O(n log n)`. | Priority queues, guarantees `O(n log n)` in-place. |

## How to Choose the Right Sorting Algorithm

*   **QuickSort**: Generally the fastest in practice for large arrays due to better cache performance and smaller constant factors, despite `O(n^2)` worst-case. Preferred when average-case performance is critical and stability is not required.
*   **MergeSort**: Guarantees `O(n log n)` performance and is stable. Ideal for linked lists (where random access is slow) and external sorting (when data doesn't fit in memory). Use when stability is a requirement.
*   **HeapSort**: Guarantees `O(n log n)` performance and is in-place. A good choice when memory is a constraint and `O(n log n)` worst-case time is needed, but stability is not an issue. It's also the basis for priority queue implementations.

## Common Mistakes

### Mistake 1: Poor Pivot Selection in QuickSort

A bad pivot choice (e.g., always picking the first or last element in an already sorted or reverse-sorted array) can lead to QuickSort's `O(n^2)` worst-case time complexity. Random pivot selection or median-of-three can help mitigate this.

### Mistake 2: Incorrect Merge Logic in MergeSort

Errors in the `merge` function can lead to incorrect sorting or `IndexOutOfBoundsException`. Ensure all elements from both sub-arrays are correctly copied back into the main array.

### Mistake 3: Heapify Errors in HeapSort

Incorrect `heapify` implementation (e.g., not correctly finding the largest child or not recursively calling `heapify` on the affected subtree) can break the heap property and thus the sort.

### Mistake 4: Off-by-one Errors in Recursion Boundaries

For all recursive sorting algorithms, carefully define the `left`, `right`, and `mid` indices to ensure all elements are processed and base cases are handled correctly.

## Practice Problems for Sorting Algorithms

1.  **Sort an Array** (LeetCode 912) - Implement various sorting algorithms.
2.  **Kth Largest Element in an Array** (LeetCode 215) - Can be solved efficiently with QuickSelect (a QuickSort variation) or a Min-Heap.
3.  **Merge Sorted Array** (LeetCode 88) - Focuses on the merge step of MergeSort.
4.  **Top K Frequent Elements** (LeetCode 347) - Often solved using a Min-Heap (priority queue).

## Interview Script You Can Reuse

```text
"For sorting an array, I would consider algorithms like QuickSort, MergeSort, and HeapSort, all offering O(n log n) average time complexity. QuickSort is generally fastest in practice due to its in-place nature and cache efficiency, but has a worst-case O(n^2). MergeSort guarantees O(n log n) in all cases and is stable, making it suitable for linked lists or when relative order of equal elements matters, though it uses O(n) extra space. HeapSort also guarantees O(n log n) and is in-place, making it a good choice for memory-constrained environments. My choice would depend on specific constraints like stability requirements, memory limits, and whether worst-case performance guarantees are critical."
```

## Final Takeaways

*   **QuickSort**: Fast in practice, in-place, but `O(n^2)` worst-case. Not stable.
*   **MergeSort**: `O(n log n)` guaranteed, stable, but `O(n)` space. Good for linked lists.
*   **HeapSort**: `O(n log n)` guaranteed, in-place, but not stable. Good for memory constraints.
*   Understand the **trade-offs** between time, space, and stability to choose the best algorithm.

Mastering these fundamental sorting algorithms is crucial for efficient data processing and a strong foundation in DSA.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
*   [Binary Search Pattern in Java](/blog/binary-search-pattern-java/)
*   [In-place Reversal of a Linked List in Java](/blog/in-place-linked-list-reversal-java/)
*   [Fast & Slow Pointers in Java](/blog/fast-slow-pointers-java/)
*   [Dutch National Flag Pattern in Java](/blog/dutch-national-flag-pattern-java/)
*   [Kadane’s Algorithm in Java](/blog/kadanes-algorithm-java/)
*   [Prefix Sum Pattern in Java](/blog/prefix-sum-pattern-java/)
*   [Sliding Window Pattern in Java](/blog/sliding-window-pattern-java/)
*   [Two Pointers Pattern in Java](/blog/two-pointers-pattern-java/)
*   [Big-O Notation in Java](/blog/big-o-notation-java-interview-problem-solving/)
