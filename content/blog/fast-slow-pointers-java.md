---
title: "Fast & Slow Pointers in Java: The Ultimate Pattern for Cycles and Middles"
description: "Master the Fast and Slow pointers (Tortoise and Hare) pattern in Java. Learn how to detect cycles, find the middle of a linked list, and solve circular array problems with linear efficiency."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "linked list", "pointers", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

The **Fast & Slow Pointers** pattern, also known as the **Tortoise and Hare algorithm**, is a pointer technique that uses two pointers moving through the data structure at different speeds.

This approach is particularly powerful for dealing with cyclic data structures (like linked lists or arrays) and for finding specific positions without knowing the total length.

## The Core Concept

We use two pointers:
- **Slow Pointer**: Moves 1 step at a time.
- **Fast Pointer**: Moves 2 steps at a time.

If there is a cycle, the fast pointer will eventually catch up to the slow pointer (they will point to the same node). If there is no cycle, the fast pointer will reach the end of the structure first.

---

## Pattern 1: Linked List Cycle Detection

This is the classic application of the pattern.

```java
public boolean hasCycle(ListNode head) {
    if (head == null) return false;
    
    ListNode slow = head;
    ListNode fast = head;
    
    while (fast != null && fast.next != null) {
        slow = slow.next;          // 1 step
        fast = fast.next.next;     // 2 steps
        
        if (slow == fast) {        // Meet!
            return true;
        }
    }
    
    return false;
}
```

**Why it works**: If you have two runners on a circular track, the faster one will eventually lap the slower one. In a linear track, the faster one just reaches the finish line.

---

## Pattern 2: Finding the Middle of a Linked List

How do you find the middle of a linked list in a single pass without knowing the length?

```java
public ListNode findMiddle(ListNode head) {
    ListNode slow = head;
    ListNode fast = head;
    
    while (fast != null && fast.next != null) {
        slow = slow.next;
        fast = fast.next.next;
    }
    
    return slow; // When fast hits the end, slow is at the middle
}
```

**Intuition**: Since the fast pointer moves twice as fast, when it covers the full distance (`N`), the slow pointer will have covered half the distance (`N/2`).

---

## Pattern 3: Finding the Start of a Cycle

Once you detect a cycle, how do you find the node where the cycle begins?

1. Detect the meeting point using Fast & Slow pointers.
2. Reset one pointer (e.g., `slow`) to the `head`.
3. Move both pointers 1 step at a time.
4. The point where they meet again is the start of the cycle.

```java
public ListNode detectCycleStart(ListNode head) {
    ListNode slow = head;
    ListNode fast = head;
    
    // Phase 1: Meeting point
    while (fast != null && fast.next != null) {
        slow = slow.next;
        fast = fast.next.next;
        if (slow == fast) break;
    }
    
    if (fast == null || fast.next == null) return null; // No cycle
    
    // Phase 2: Finding start
    slow = head;
    while (slow != fast) {
        slow = slow.next;
        fast = fast.next;
    }
    
    return slow;
}
```

## When to Use Fast & Slow Pointers?

Look for these scenarios in interviews:
- Problems involving **Linked Lists** where you need to find a position relative to the end or middle.
- Any problem mentioning a **Cycle** or a **Loop**.
- Circular arrays or paths.
- Finding the $k^{th}$ element from the end (though Two Pointers can also do this).

| Use Case | Strategy | Result |
|---|---|---|
| Detect Loop | Fast & Slow | Boolean |
| Find Middle | Fast & Slow | Node |
| Find $k^{th}$ from end | Fast @ k steps ahead | Node |
| Palindrome List | Find middle + Reverse 2nd half | Boolean |

## Summary

The Fast & Slow Pointers pattern is elegant because it solves complex traversal problems in `O(n)` time and `O(1)` space. By decoupling the speeds of your pointers, you can extract structural information from a data structure that would otherwise require multiple passes or extra memory.
