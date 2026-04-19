---
title: "Boyer-Moore Voting Algorithm in Java: Finding the Majority Element"
description: "Learn the Boyer-Moore Voting Algorithm in Java. Discover how to find the majority element in an array in linear time and constant space, a common and elegant interview favorite."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "algorithms", "majority element", "boyer-moore", "interview preparation"]
featured: false
affiliateSection: "java-courses"
---

Finding the "majority element" in an array (an element that appears more than $n/2$ times) is a classic interview problem. While you could solve it with a Hash Map in $O(n)$ time and $O(n)$ space, the **Boyer-Moore Voting Algorithm** allows you to do it in **$O(n)$ time and $O(1)$ space**.

It is one of the most elegant examples of how a simple "counting" trick can replace a heavy data structure.

## The Core Concept: The Battle of Elements

Imagine the array elements are different parties in an election. If one party has more than 50% of the total votes, they can "cancel out" every other vote and still have at least one vote left.

**The Logic**:
1. Maintain a `candidate` and a `count`.
2. Iterate through the array:
   - If `count` is 0, set the current element as the `candidate`.
   - If the current element is the same as the `candidate`, increment `count`.
   - If it's different, decrement `count`.
3. The remaining `candidate` is your majority element (if one exists).

---

## Boyer-Moore Implementation in Java

```java
public class BoyerMooreVoting {
    public int findMajorityElement(int[] nums) {
        int count = 0;
        Integer candidate = null;

        for (int num : nums) {
            if (count == 0) {
                candidate = num;
            }
            count += (num == candidate) ? 1 : -1;
        }

        // Optional: Verify if the candidate is actually the majority element
        // (Only required if the problem doesn't guarantee a majority exists)
        if (verify(nums, candidate)) {
            return candidate;
        }
        
        return -1; // Or throw exception
    }

    private boolean verify(int[] nums, int candidate) {
        int actualCount = 0;
        for (int num : nums) {
            if (num == candidate) actualCount++;
        }
        return actualCount > nums.length / 2;
    }
}
```

---

## Why is it better than a Hash Map?

| Feature | Hash Map Approach | Boyer-Moore |
|---|---|---|
| **Time Complexity** | $O(n)$ | $O(n)$ |
| **Space Complexity** | $O(n)$ | $O(1)$ |
| **Simplicity** | Requires collections | Pure primitive logic |

## When to use Boyer-Moore?

Reach for this algorithm specifically when the problem statement mentions:
- "Majority element"
- "More than $n/2$ occurrences"
- "Constant space requirement"

There is also a generalized version of this algorithm to find elements that appear more than $n/k$ times (using $k-1$ candidates and counters).

## Summary

The Boyer-Moore Voting Algorithm is a masterclass in efficiency. By realizing that a majority element can survive a "war of attrition" with all other elements, we eliminate the need for extra memory entirely. In an interview, this solution shows that you don't just know how to use data structures—you know how to optimize beyond them.
