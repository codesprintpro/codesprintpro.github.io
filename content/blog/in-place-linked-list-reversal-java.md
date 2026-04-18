---
title: "In-place Reversal of a Linked List in Java: Efficient Memory Management"
description: "Master the in-place reversal of a linked list in Java. Learn the iterative and recursive approaches, their intuition, dry runs, and complexity analysis for optimal memory usage."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "linked list", "in-place reversal", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

## Introduction to In-place Linked List Reversal

Reversing a linked list is a fundamental operation in Data Structures and Algorithms (DSA) that frequently appears in technical interviews. The **in-place reversal** technique is particularly valued because it modifies the list by re-pointing existing nodes without allocating new memory for additional nodes. This makes it highly memory-efficient, achieving `O(1)` space complexity.

Understanding how to reverse a linked list in-place is crucial for mastering linked list manipulations and forms the basis for solving more complex problems, such as reversing parts of a list, checking for palindromes, or merging sorted lists.

## When Should You Think About In-place Linked List Reversal?

Consider in-place linked list reversal when:

*   You are given a **singly linked list**.
*   You need to **reverse the order of nodes** in the list.
*   The problem specifies or implies a **memory constraint** (e.g., `O(1)` space complexity).
*   You need to reverse a **segment of a linked list**.

## Core Concept of In-place Reversal

The iterative approach to in-place linked list reversal involves maintaining three pointers:

1.  `prev`: Points to the previously processed node. Initially `null`.
2.  `curr`: Points to the current node being processed. Initially `head`.
3.  `nextTemp`: Temporarily stores the next node to be processed before `curr.next` is changed.

The algorithm iterates through the list, and in each step, it:

1.  Saves the `curr.next` node into `nextTemp`.
2.  Reverses the link: `curr.next` is set to `prev`.
3.  Moves `prev` to `curr`.
4.  Moves `curr` to `nextTemp`.

This process continues until `curr` becomes `null`, at which point `prev` will be pointing to the new head of the reversed list.

## Example: Reverse a Singly Linked List

Given the `head` of a singly linked list, reverse the list, and return the reversed list.

#### Brute Force Approach (using extra space)

A less efficient approach might involve creating new nodes or storing all node values in an array/stack and then reconstructing the list. This uses `O(n)` extra space.

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
    public ListNode reverseListBruteForce(ListNode head) {
        if (head == null) {
            return null;
        }
        // Using a stack to store nodes and then pop them to reverse
        java.util.Stack<ListNode> stack = new java.util.Stack<>();
        ListNode current = head;
        while (current != null) {
            stack.push(current);
            current = current.next;
        }

        ListNode newHead = stack.pop();
        current = newHead;
        while (!stack.isEmpty()) {
            current.next = stack.pop();
            current = current.next;
        }
        current.next = null; // Important: last node's next should be null
        return newHead;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, as we traverse the list twice (once to push, once to pop).
*   **Space Complexity**: `O(n)`, due to the stack storing all `n` nodes.

#### Optimized with In-place Iterative Reversal

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
    public ListNode reverseList(ListNode head) {
        ListNode prev = null;
        ListNode curr = head;
        ListNode nextTemp = null;

        while (curr != null) {
            nextTemp = curr.next; // Save next node
            curr.next = prev;     // Reverse current node's pointer
            prev = curr;          // Move prev to current node
            curr = nextTemp;      // Move current to next node
        }
        return prev; // prev is now the new head
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, as we iterate through the list once.
*   **Space Complexity**: `O(1)`, as we only use a few extra pointers.

### Dry Run: In-place Iterative Reversal

**Input:** Linked List `1 -> 2 -> 3 -> 4 -> 5 -> null`

| Step | `prev` | `curr` | `nextTemp` | `curr.next` (after update) | `prev` (after update) | `curr` (after update) | List State (conceptual) |
|------|--------|--------|------------|----------------------------|-----------------------|-----------------------|
| Init | null   | 1      | null       | -                          | -                     | -                     | `1 -> 2 -> 3 -> 4 -> 5 -> null` |
| 1    | null   | 1      | 2          | `1 -> null`                | 1                     | 2                     | `null <- 1   2 -> 3 -> 4 -> 5 -> null` |
| 2    | 1      | 2      | 3          | `2 -> 1`                   | 2                     | 3                     | `null <- 1 <- 2   3 -> 4 -> 5 -> null` |
| 3    | 2      | 3      | 4          | `3 -> 2`                   | 3                     | 4                     | `null <- 1 <- 2 <- 3   4 -> 5 -> null` |
| 4    | 3      | 4      | 5          | `4 -> 3`                   | 4                     | 5                     | `null <- 1 <- 2 <- 3 <- 4   5 -> null` |
| 5    | 4      | 5      | null       | `5 -> 4`                   | 5                     | null                  | `null <- 1 <- 2 <- 3 <- 4 <- 5` |
| End  | 5      | null   | null       | -                          | -                     | -                     | Loop terminates. Return `prev` (node 5). |

**Result:** `5 -> 4 -> 3 -> 2 -> 1 -> null`

## Recursive Approach to In-place Reversal

While the iterative approach is generally preferred for its clarity and avoidance of stack overflow for very long lists, a recursive solution also exists and demonstrates a different way of thinking about the problem.

```java
class Solution {
    public ListNode reverseListRecursive(ListNode head) {
        // Base case: if head is null or only one node, it's already reversed
        if (head == null || head.next == null) {
            return head;
        }

        // Recursively reverse the rest of the list
        ListNode restReversed = reverseListRecursive(head.next);

        // After recursion, head.next is the last node of the original list
        // and now the second node of the reversed 'restReversed' list.
        // We make head.next.next point to head to reverse the link.
        head.next.next = head;

        // The current head becomes the tail of the reversed list, so its next is null
        head.next = null;

        // 'restReversed' is the new head of the entire reversed list
        return restReversed;
    }
}
```

**Complexity:**

*   **Time Complexity**: `O(n)`, as each node is visited once.
*   **Space Complexity**: `O(n)`, due to the recursion stack. In the worst case (a very long list), this could lead to a stack overflow.

## Reusable Template for In-place Linked List Reversal

```java
class LinkedListReversal {
    static class ListNode {
        int val;
        ListNode next;
        ListNode(int x) {
            val = x;
            next = null;
        }
    }

    // Iterative In-place Reversal
    public ListNode reverseIterative(ListNode head) {
        ListNode prev = null;
        ListNode curr = head;
        
        while (curr != null) {
            ListNode nextTemp = curr.next; // Store next
            curr.next = prev;             // Reverse current node's pointer
            prev = curr;                  // Move prev one step forward
            curr = nextTemp;              // Move curr one step forward
        }
        return prev; // prev is the new head
    }

    // Recursive In-place Reversal
    public ListNode reverseRecursive(ListNode head) {
        if (head == null || head.next == null) {
            return head;
        }
        ListNode restReversed = reverseRecursive(head.next);
        head.next.next = head;
        head.next = null;
        return restReversed;
    }
}
```

## How to Recognize In-place Linked List Reversal in Interviews

Look for these clues:

*   **Data Structure**: Singly Linked List.
*   **Goal**: Change the order of nodes from `A -> B -> C` to `C -> B -> A`.
*   **Constraint**: Explicit mention of `O(1)` space complexity or avoiding new node creation.
*   **Variations**: Reversing a sub-portion of a linked list (e.g., between two given nodes), reversing every `k` nodes.

## Common Mistakes

### Mistake 1: Losing track of the `next` node

Before changing `curr.next`, always save a reference to `curr.next` (e.g., `nextTemp = curr.next;`) otherwise you lose the rest of the list.

### Mistake 2: Incorrectly setting the `next` of the original head

After the loop, the original head node becomes the tail of the reversed list. Its `next` pointer must be set to `null` to properly terminate the list. The iterative solution handles this naturally as `curr` becomes `null` and `prev` holds the new head.

### Mistake 3: Handling `null` or single-node lists

Always ensure your code correctly handles empty lists (`head == null`) or lists with only one node (`head.next == null`). These are often base cases for both iterative and recursive solutions.

## In-place Reversal vs. Other Linked List Operations

*   **In-place Reversal**: Modifies the `next` pointers of existing nodes to change the list's direction without creating new nodes. Focuses on memory efficiency.
*   **Copying/Cloning**: Creates an entirely new list with new nodes, preserving the original list. Uses `O(n)` space.
*   **Fast & Slow Pointers**: Uses two pointers at different speeds, often for cycle detection or finding middle elements, but doesn't directly reverse the list.

## Practice Problems for This Pattern

1.  **Reverse Linked List** (LeetCode 206) - The classic problem.
2.  **Reverse Linked List II** (LeetCode 92) - Reverse a sub-list from position `m` to `n`.
3.  **Reverse Nodes in k-Group** (LeetCode 25) - Reverse every `k` nodes.
4.  **Palindrome Linked List** (LeetCode 234) - Often involves reversing the second half of the list.

## Interview Script You Can Reuse

```text
"To reverse this linked list in-place with O(1) space, I'll use an iterative approach with three pointers: `prev`, `curr`, and `nextTemp`. `prev` will start at `null`, `curr` at `head`. In each step, I'll first store `curr.next` in `nextTemp` to avoid losing the rest of the list. Then, I'll reverse the current node's pointer by setting `curr.next = prev`. After that, I'll advance `prev` to `curr` and `curr` to `nextTemp`. This process continues until `curr` becomes `null`, at which point `prev` will be the new head of the reversed list. This ensures an O(n) time complexity and O(1) space complexity."
```

## Final Takeaways

*   **In-place Linked List Reversal** is a memory-efficient technique.
*   The **iterative approach** is generally preferred due to `O(1)` space complexity and avoiding stack overflow.
*   Key pointers: `prev`, `curr`, `nextTemp`.
*   Crucial for problems requiring **list manipulation without extra memory**.
*   Careful handling of `null` and single-node lists is essential.

Mastering linked list reversal is a foundational skill that unlocks solutions to many other complex linked list problems.

## Read Next

*   [DSA in Java Series](/blog/category/dsa/)
*   [Fast & Slow Pointers in Java](/blog/fast-slow-pointers-java/)
*   [Dutch National Flag Pattern in Java](/blog/dutch-national-flag-pattern-java/)
*   [Kadane’s Algorithm in Java](/blog/kadanes-algorithm-java/)
*   [Prefix Sum Pattern in Java](/blog/prefix-sum-pattern-java/)
*   [Sliding Window Pattern in Java](/blog/sliding-window-pattern-java/)
*   [Two Pointers Pattern in Java](/blog/two-pointers-pattern-java/)
*   [Big-O Notation in Java](/blog/big-o-notation-java-interview-problem-solving/)
