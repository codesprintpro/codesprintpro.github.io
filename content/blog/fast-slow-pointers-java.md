---
title: "Fast & Slow Pointers in Java: Detecting Cycles and Finding Middle Elements"
description: "Master the Fast & Slow Pointers pattern in Java for efficient cycle detection, finding middle elements, and other linked list problems. Learn its intuition, algorithm, dry runs, and complexity analysis."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "fast slow pointers", "linked list", "cycle detection", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to the Fast & Slow Pointers Pattern

The **Fast & Slow Pointers pattern**, also known as the Hare and Tortoise algorithm, is a powerful and elegant technique used primarily in problems involving linked lists and arrays. It employs two pointers that traverse the data structure at different speeds. This difference in speed allows the pointers to interact in specific ways, making it highly effective for tasks like detecting cycles, finding the middle element, or determining the length of a cycle.

The intuition behind this pattern is that if a faster pointer eventually catches up to a slower pointer, it implies the existence of a cycle. If the faster pointer reaches the end of the structure (e.g., `null` in a linked list), then no cycle exists.

## When Should You Think About Fast & Slow Pointers?

Consider the Fast & Slow Pointers pattern when:

*   You are dealing with **linked lists or arrays**.
*   You need to **detect a cycle** within the structure.
*   You need to **find the starting point of a cycle**.
*   You need to **find the middle element** of a linked list.
*   You need to **determine the length of a cycle**.
*   You need to solve problems in **`O(1)` space complexity** (without using extra data structures like hash sets).

## Core Concept of Fast & Slow Pointers

The pattern typically involves two pointers:

1.  **Slow Pointer (Tortoise)**: Moves one step at a time.
2.  **Fast Pointer (Hare)**: Moves two steps at a time.

### Cycle Detection (Floyd's Cycle-Finding Algorithm)

If there is a cycle, the fast pointer will eventually catch up to the slow pointer. This is because for every step the slow pointer takes, the fast pointer takes two. The relative speed difference means the fast pointer gains one step on the slow pointer in each iteration. If they are in a cycle, they are bound to meet.

### Finding the Middle Element

When the fast pointer reaches the end of the linked list (or `null`), the slow pointer will be at the middle of the list. This works because the fast pointer moves twice as fast as the slow pointer, covering twice the distance.

## Example 1: Cycle Detection in a Linked List

Given the `head` of a singly linked list, return `true` if there is a cycle in the linked list. Otherwise, return `false`.

#### Brute Force Approach (using a HashSet)

A naive approach would be to traverse the linked list and store each node in a hash set. If we encounter a node that is already in the hash set, then a cycle exists.

```java
import java.util.HashSet;
import java.util.Set;

class ListNode {
    int val;
    ListNode next;
    ListNode(int x) {
        val = x;
        next = null;
    }
}

class Solution {
    public boolean hasCycleBruteForce(ListNode head) {
        Set<ListNode> visitedNodes = new HashSet<>();
        ListNode current = head;
        while (current != null) {
            if (visitedNodes.contains(current)) {
                return true;
            }
            visitedNodes.add(current);
            current = current.next;
        }
        return false;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, where `n` is the number of nodes in the linked list, as we traverse each node once. Hash set operations take `O(1)` on average.
*   **Space Complexity**: `O(n)`, as in the worst case (no cycle), we store all `n` nodes in the hash set.

#### Optimized with Fast & Slow Pointers

```java
class ListNode {
    int val;
    ListNode next;
    ListNode(int x) {
        val = x;
        next = null;
    }
}

class Solution {
    public boolean hasCycle(ListNode head) {
        if (head == null || head.next == null) {
            return false;
        }

        ListNode slow = head;
        ListNode fast = head;

        while (fast != null && fast.next != null) {
            slow = slow.next;
            fast = fast.next.next;

            if (slow == fast) {
                return true; // Cycle detected
            }
        }
        return false; // No cycle
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, as in the worst case, the fast pointer traverses the list twice.
*   **Space Complexity**: `O(1)`, as we only use two pointers.

### Dry Run: Cycle Detection

**Input:** Linked List `1 -> 2 -> 3 -> 4 -> 5 -> 2 (cycle back to 2)`

| Step | `slow` (node value) | `fast` (node value) | Condition (`slow == fast`) | Notes |
|------|---------------------|---------------------|----------------------------|-------|
| Init | 1                   | 1                   | false                      |       |
| 1    | 2                   | 3                   | false                      | `slow` moves to 2, `fast` moves to 3 |
| 2    | 3                   | 5                   | false                      | `slow` moves to 3, `fast` moves to 5 |
| 3    | 4                   | 2 (from 5.next)     | false                      | `slow` moves to 4, `fast` moves to 2 |
| 4    | 5                   | 4 (from 2.next.next)| false                      | `slow` moves to 5, `fast` moves to 4 |
| 5    | 2 (from 5.next)     | 2 (from 4.next.next)| true                       | `slow` moves to 2, `fast` moves to 2. They meet! Cycle detected. |

**Result:** `true`

## Example 2: Finding the Middle of a Linked List

Given the `head` of a singly linked list, return the middle node of the list. If there are two middle nodes, return the second middle node.

#### Brute Force Approach

A naive approach would be to first traverse the list to count all nodes, then traverse again to the `n/2`-th node.

```java
class Solution {
    public ListNode middleNodeBruteForce(ListNode head) {
        int count = 0;
        ListNode current = head;
        while (current != null) {
            count++;
            current = current.next;
        }

        int middleIndex = count / 2;
        current = head;
        for (int i = 0; i < middleIndex; i++) {
            current = current.next;
        }
        return current;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, as we traverse the list twice.
*   **Space Complexity**: `O(1)`.

#### Optimized with Fast & Slow Pointers

```java
class Solution {
    public ListNode middleNode(ListNode head) {
        ListNode slow = head;
        ListNode fast = head;

        while (fast != null && fast.next != null) {
            slow = slow.next;
            fast = fast.next.next;
        }
        return slow; // When fast reaches end, slow is at middle
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, as the fast pointer traverses the list once (or almost twice), and the slow pointer traverses half the list.
*   **Space Complexity**: `O(1)`.

### Dry Run: Finding the Middle Node

**Input:** Linked List `1 -> 2 -> 3 -> 4 -> 5`

| Step | `slow` (node value) | `fast` (node value) | Condition (`fast != null && fast.next != null`) | Notes |
|------|---------------------|---------------------|-------------------------------------------------|-------|
| Init | 1                   | 1                   | true                                            |       |
| 1    | 2                   | 3                   | true                                            | `slow` moves to 2, `fast` moves to 3 |
| 2    | 3                   | 5                   | true                                            | `slow` moves to 3, `fast` moves to 5 |
| 3    | 4                   | null                | false                                           | `slow` moves to 4, `fast` moves to `5.next` (null). Loop terminates. |

**Result:** `slow` is at node `3`.

**Input:** Linked List `1 -> 2 -> 3 -> 4 -> 5 -> 6`

| Step | `slow` (node value) | `fast` (node value) | Condition (`fast != null && fast.next != null`) | Notes |
|------|---------------------|---------------------|-------------------------------------------------|-------|
| Init | 1                   | 1                   | true                                            |       |
| 1    | 2                   | 3                   | true                                            | `slow` moves to 2, `fast` moves to 3 |
| 2    | 3                   | 5                   | true                                            | `slow` moves to 3, `fast` moves to 5 |
| 3    | 4                   | null                | false                                           | `slow` moves to 4, `fast` moves to `5.next.next` (null). Loop terminates. |

**Result:** `slow` is at node `4` (the second middle node).

## Reusable Template for Fast & Slow Pointers

```java
class FastSlowPointers {
    // Generic structure for linked list node
    static class ListNode {
        int val;
        ListNode next;
        ListNode(int x) {
            val = x;
            next = null;
        }
    }

    // Template for cycle detection
    public boolean detectCycle(ListNode head) {
        if (head == null || head.next == null) {
            return false;
        }

        ListNode slow = head;
        ListNode fast = head;

        while (fast != null && fast.next != null) {
            slow = slow.next;
            fast = fast.next.next;

            if (slow == fast) {
                return true; // Cycle detected
            }
        }
        return false; // No cycle
    }

    // Template for finding middle element
    public ListNode findMiddle(ListNode head) {
        if (head == null) {
            return null;
        }

        ListNode slow = head;
        ListNode fast = head;

        while (fast != null && fast.next != null) {
            slow = slow.next;
            fast = fast.next.next;
        }
        return slow; // slow will be at the middle
    }

    // Template for finding cycle start (requires cycle detection first)
    public ListNode findCycleStart(ListNode head) {
        ListNode slow = head;
        ListNode fast = head;
        int cycleLength = 0;

        while (fast != null && fast.next != null) {
            slow = slow.next;
            fast = fast.next.next;
            if (slow == fast) { // Cycle detected
                cycleLength = calculateCycleLength(slow); // Helper to find length
                break;
            }
        }

        if (cycleLength == 0) { // No cycle
            return null;
        }

        // Find start of the cycle
        ListNode pointer1 = head;
        ListNode pointer2 = head;
        // Move pointer2 ahead by cycleLength nodes
        for (int i = 0; i < cycleLength; i++) {
            pointer2 = pointer2.next;
        }

        // Move both pointers one step at a time until they meet
        while (pointer1 != pointer2) {
            pointer1 = pointer1.next;
            pointer2 = pointer2.next;
        }
        return pointer1; // Both pointers meet at the start of the cycle
    }

    private int calculateCycleLength(ListNode slow) {
        ListNode current = slow;
        int length = 0;
        do {
            current = current.next;
            length++;
        } while (current != slow);
        return length;
    }
}
```

## How to Recognize Fast & Slow Pointers in Interviews

Look for these clues:

*   **Data Structure**: Linked Lists or sometimes arrays where elements point to other indices (simulating a linked list).
*   **Problem Type**: Questions involving cycles (detection, start, length), finding the middle element, or finding the `k`-th node from the end (can be solved with two pointers, one `k` steps ahead).
*   **Constraint**: Often requires an **`O(1)` space complexity** solution.

## Common Mistakes

### Mistake 1: Incorrect Initialization

For cycle detection, both `slow` and `fast` pointers should start at `head`. For finding the middle, they also start at `head`.

### Mistake 2: Incorrect Loop Conditions

For cycle detection and middle finding, the loop condition `while (fast != null && fast.next != null)` is crucial. If `fast` or `fast.next` becomes `null`, it means the end of the list has been reached, and there is no cycle.

### Mistake 3: Off-by-one for Middle Element

If the list has an even number of nodes, the slow pointer will naturally stop at the second of the two middle nodes, which is often the desired behavior. Be aware of problem specifics if the *first* middle node is required for even-length lists.

## Fast & Slow Pointers vs. Two Pointers (General)

*   **Two Pointers (General)**: A broad category where two pointers are used to traverse a data structure, often for comparison, modification, or finding pairs. Pointers can move in the same direction, opposite directions, or with different speeds.
*   **Fast & Slow Pointers**: A specific application of the two-pointer technique where the pointers move at different speeds, making it uniquely suited for cycle detection and relative distance problems in linked lists.

## Practice Problems for This Pattern

1.  **Linked List Cycle** (LeetCode 141) - Classic cycle detection.
2.  **Linked List Cycle II** (LeetCode 142) - Find the start of the cycle.
3.  **Middle of the Linked List** (LeetCode 876) - Find the middle element.
4.  **Happy Number** (LeetCode 202) - Can be solved by detecting a cycle in the sequence of sums of squares of digits.
5.  **Find Duplicate Number** (LeetCode 287) - Can be solved in an array by treating values as pointers to indices, effectively forming a linked list with a cycle.

## Interview Script You Can Reuse

```text
"This problem involves a linked list and requires detecting a cycle (or finding the middle element) without using extra space. This immediately suggests the Fast & Slow Pointers pattern. I'll initialize two pointers, `slow` and `fast`, both starting at the head. `slow` will move one step at a time, while `fast` will move two steps at a time. If `fast` ever meets `slow`, a cycle exists. If `fast` reaches the end of the list (`null`), then no cycle exists. For finding the middle, when `fast` reaches the end, `slow` will naturally be at the middle of the list. This approach provides an optimal O(n) time complexity and O(1) space complexity."
```

## Final Takeaways

*   **Fast & Slow Pointers** is a specialized **two-pointer technique**.
*   Primarily used for **linked lists** to detect cycles, find cycle start, and find middle elements.
*   Achieves **`O(n)` time complexity** and **`O(1)` space complexity**.
*   The relative speed difference is key to its effectiveness.

Mastering this pattern is essential for solving a variety of linked list problems efficiently and is a common interview topic.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
*   [Dutch National Flag Pattern in Java](/blog/dutch-national-flag-pattern-java/)
*   [Kadane’s Algorithm in Java](/blog/kadanes-algorithm-java/)
*   [Prefix Sum Pattern in Java](/blog/prefix-sum-pattern-java/)
*   [Sliding Window Pattern in Java](/blog/sliding-window-pattern-java/)
*   [Two Pointers Pattern in Java](/blog/two-pointers-pattern-java/)
*   [Big-O Notation in Java](/blog/big-o-notation-java-interview-problem-solving/)
