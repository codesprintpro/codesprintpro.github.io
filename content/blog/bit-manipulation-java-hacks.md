---
title: "Bit Manipulation in Java: Interview Hacks and Patterns"
description: "Master bit manipulation for Java interviews. Learn the essential XOR tricks, how to count set bits, and how to perform arithmetic operations without using standard operators."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "bit manipulation", "binary", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

Bit manipulation is often considered a "low-level" topic, but it is a favorite among interviewers for testing your understanding of how data is actually stored in memory.

By working directly with bits (0s and 1s), you can often solve problems in $O(1)$ space and $O(1)$ time that would otherwise require complex data structures.

## The Essential Operators

Before the "hacks", you must be comfortable with these basics:

| Operator | Symbol | Rule |
|---|---|---|
| **AND** | `&` | 1 if both are 1 |
| **OR** | `|` | 1 if either is 1 |
| **XOR** | `^` | 1 if they are different |
| **NOT** | `~` | Flip all bits |
| **Left Shift** | `<<` | Multiply by 2 |
| **Right Shift** | `>>` | Divide by 2 (keeps sign) |

---

## 1. The Magic of XOR (`^`)

The XOR operator has unique properties that make it a "cheat code" for certain problems:
1. `x ^ x = 0` (Any number XORed with itself is zero)
2. `x ^ 0 = x` (Any number XORed with zero is itself)
3. `x ^ y = y ^ x` (Order doesn't matter)

### Classic Problem: Find the Single Number
Given an array where every number appears twice except for one, find that single number.

```java
public int singleNumber(int[] nums) {
    int res = 0;
    for (int n : nums) {
        res ^= n; // The pairs cancel each other out!
    }
    return res;
}
```

---

## 2. Counting Set Bits (Brian Kernighan’s Algorithm)

How do you count the number of `1`s in a binary representation?

```java
public int countSetBits(int n) {
    int count = 0;
    while (n != 0) {
        n &= (n - 1); // This magic line clears the rightmost set bit
        count++;
    }
    return count;
}
```

**Why it works**: `n - 1` flips all the bits to the right of the rightmost set bit (including that bit itself). When you `&` it with `n`, that bit becomes `0`.

---

## 3. Power of Two Check

Check if a number is a power of two without using loops or math functions.

```java
public boolean isPowerOfTwo(int n) {
    if (n <= 0) return false;
    return (n & (n - 1)) == 0;
}
```

**Intuition**: A power of two in binary is always a `1` followed by only `0`s (e.g., `8` is `1000`). `n-1` for a power of two will be all `1`s (e.g., `7` is `0111`). Their `&` will always be `0`.

---

## 4. Swapping Two Numbers Without a Temp Variable

```java
public void swap(int a, int b) {
    a = a ^ b;
    b = a ^ b; // b becomes original a
    a = a ^ b; // a becomes original b
}
```

## Summary Checklist for Bit Manipulation

- **Get $i^{th}$ bit**: `(n >> i) & 1`
- **Set $i^{th}$ bit**: `n | (1 << i)`
- **Clear $i^{th}$ bit**: `n & ~(1 << i)`
- **Toggle $i^{th}$ bit**: `n ^ (1 << i)`
- **Divide by 2**: `n >> 1`
- **Multiply by 2**: `n << 1`

## Conclusion

Bit manipulation is about recognizing patterns in binary. While it may feel unintuitive at first, mastering these few "hacks" (especially XOR and the `n & (n-1)` trick) will help you breeze through some of the trickiest questions in the DSA interview circuit.
