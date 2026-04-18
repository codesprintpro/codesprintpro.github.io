---
title: "Two Pointers Pattern in Java: Solve Array and String Problems Efficiently"
description: "Learn the two pointers pattern in Java with clear intuition, reusable templates, dry runs, and interview-style examples for arrays, strings, and in-place problems."
date: "2026-04-18"
category: "DSA"
tags: ["dsa", "java", "two pointers", "arrays", "strings", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

The two pointers pattern is one of the fastest ways to turn a slow nested-loop solution into a clean linear-time solution.

It shows up everywhere:

- sorted arrays
- palindrome problems
- deduplication
- partitioning
- linked list cycle detection
- sliding window style scans

The core idea is simple:

**instead of restarting work from scratch, keep two moving positions that preserve useful information as you scan.**

Once that clicks, a lot of interview problems stop looking like separate tricks.

## What Two Pointers Means

A "pointer" in DSA interview language usually just means an index or reference.

In Java, that might be:

- two indices in an array
- two indices in a string
- two node references in a linked list

The pattern works when the relative movement of those two positions helps you avoid repeated work.

Common versions:

1. **opposite-direction pointers**  
   Start one pointer on the left and one on the right.

2. **same-direction pointers**  
   One pointer explores, another pointer tracks where the next valid answer should go.

3. **fast and slow pointers**  
   One pointer moves faster than the other, often in linked lists.

This article focuses on the first two because they are the most common starting point in array and string interviews.

## When Should You Think About Two Pointers?

Reach for two pointers when:

- the data is sorted
- you need pairs or ranges
- you need to shrink or expand a valid segment
- you need to modify an array in place
- you are comparing from both ends inward

If your first instinct is a nested loop over pairs, pause and ask:

```text
Can two moving positions preserve enough state to avoid checking every pair?
```

That question alone unlocks a lot of solutions.

## Pattern 1: Opposite-Direction Pointers

This usually works on sorted input.

Classic example: find whether a sorted array has two numbers whose sum equals a target.

### Brute Force

```java
boolean hasPairWithTarget(int[] nums, int target) {
    for (int i = 0; i < nums.length; i++) {
        for (int j = i + 1; j < nums.length; j++) {
            if (nums[i] + nums[j] == target) {
                return true;
            }
        }
    }
    return false;
}
```

Complexity:

- time: `O(n^2)`
- space: `O(1)`

### Optimized with Two Pointers

```java
boolean hasPairWithTarget(int[] nums, int target) {
    int left = 0;
    int right = nums.length - 1;

    while (left < right) {
        int sum = nums[left] + nums[right];

        if (sum == target) {
            return true;
        }

        if (sum < target) {
            left++;
        } else {
            right--;
        }
    }

    return false;
}
```

Complexity:

- time: `O(n)`
- space: `O(1)`

### Why It Works

Because the array is sorted.

If:

```text
nums[left] + nums[right] < target
```

then the left value is too small for the current right boundary, so moving `right` inward would only make the sum smaller. The only useful move is to increase `left`.

If:

```text
nums[left] + nums[right] > target
```

then the sum is too large, so moving `left` forward would only make it larger. The useful move is to decrease `right`.

That is the heart of the pattern: **sorted order tells you which pointer move can still lead to a valid answer.**

## Dry Run

Array:

```text
[1, 2, 4, 6, 10, 14]
target = 12
```

Steps:

1. `left = 0`, `right = 5` -> `1 + 14 = 15` -> too large -> move `right`
2. `left = 0`, `right = 4` -> `1 + 10 = 11` -> too small -> move `left`
3. `left = 1`, `right = 4` -> `2 + 10 = 12` -> found

No pair is checked twice. No unnecessary restart happens.

## Pattern 2: Same-Direction Pointers

This version is common when you need to:

- filter values in place
- deduplicate a sorted array
- compact valid values to the front

One pointer reads input. Another pointer marks where the next valid output should go.

### Example: Remove Duplicates from Sorted Array

Given a sorted array, keep only one copy of each value and return the new logical length.

```java
int removeDuplicates(int[] nums) {
    if (nums.length == 0) {
        return 0;
    }

    int write = 1;

    for (int read = 1; read < nums.length; read++) {
        if (nums[read] != nums[read - 1]) {
            nums[write] = nums[read];
            write++;
        }
    }

    return write;
}
```

### Why It Works

- `read` scans every element
- `write` tracks where the next unique element should go
- because the array is sorted, duplicates are adjacent

That adjacency is what makes the check cheap.

### Dry Run

Input:

```text
[1, 1, 2, 2, 2, 3, 4, 4]
```

State changes:

```text
write = 1
read = 1 -> nums[1] == nums[0] -> skip
read = 2 -> nums[2] != nums[1] -> nums[1] = 2, write = 2
read = 3 -> duplicate -> skip
read = 4 -> duplicate -> skip
read = 5 -> nums[5] != nums[4] -> nums[2] = 3, write = 3
read = 6 -> nums[6] != nums[5] -> nums[3] = 4, write = 4
read = 7 -> duplicate -> skip
```

Valid prefix after processing:

```text
[1, 2, 3, 4]
```

Complexity:

- time: `O(n)`
- space: `O(1)`

## Pattern 3: Compare from Both Ends

Palindrome problems are another natural fit.

```java
boolean isPalindrome(String s) {
    int left = 0;
    int right = s.length() - 1;

    while (left < right) {
        if (s.charAt(left) != s.charAt(right)) {
            return false;
        }
        left++;
        right--;
    }

    return true;
}
```

This is better than reversing the string just to compare it.

Complexity:

- time: `O(n)`
- space: `O(1)`

If the problem says to ignore punctuation or case, you still use the same structure. You just add logic to skip unwanted characters before comparing.

## A Reusable Template

When you suspect two pointers, this skeleton helps:

```java
int left = 0;
int right = nums.length - 1;

while (left < right) {
    // evaluate current state

    if (/* found answer */) {
        // return or record result
    } else if (/* need a larger value / range */) {
        left++;
    } else {
        right--;
    }
}
```

For same-direction compaction:

```java
int write = 0;

for (int read = 0; read < nums.length; read++) {
    if (/* nums[read] should stay */) {
        nums[write] = nums[read];
        write++;
    }
}
```

The main skill is not memorizing code. It is understanding what information each pointer represents.

## How to Recognize Two Pointers in Interviews

Clues that strongly suggest it:

- the input is sorted
- the problem asks for a pair, triplet, or subrange
- you need `O(1)` extra space
- you are asked to modify the array in place
- the brute force is obviously nested loops

For triplet problems like 3Sum, two pointers often appear **inside** a loop:

1. fix one element
2. solve the remaining pair problem with two pointers

That is how many `O(n^3)` solutions drop to `O(n^2)`.

## Common Mistakes

### Mistake 1: Using two pointers on unsorted data without justification

For pair-sum style problems, opposite-direction pointers usually rely on sorting.

If the array is unsorted and you do not sort it first, the pointer movement has no guarantee behind it.

### Mistake 2: Forgetting what the problem allows you to mutate

Sometimes sorting is fine.

Sometimes you must preserve original index positions.

That changes whether you should use sorting + two pointers or a hash map.

### Mistake 3: Moving both pointers blindly

Each pointer move should be justified by the current state.

If you cannot explain *why* `left++` is safe, the solution is probably not solid yet.

### Mistake 4: Off-by-one errors

Most loops should be:

```java
while (left < right)
```

not:

```java
while (left <= right)
```

unless the problem explicitly needs the pointers to meet and still process the same element.

### Mistake 5: Forgetting duplicates

Problems like 3Sum often require skipping equal neighboring values to avoid duplicate answers.

That is still a two pointers problem, but duplicate handling becomes part of the correctness.

## Two Pointers vs Hashing

Sometimes both approaches work.

For example, pair sum:

- hash map solution on unsorted input: `O(n)` time, `O(n)` space
- two pointers on sorted input: `O(n)` time, `O(1)` space after sorting considerations

If sorting is required first, total time becomes `O(n log n)`.

So the right answer depends on the constraints:

- need original indices -> hash map is often better
- need constant extra space -> two pointers is attractive
- already sorted input -> two pointers is usually ideal

That kind of trade-off discussion makes interview answers stronger.

## Practice Problems for This Pattern

Start with these:

1. Two Sum II on a sorted array
2. Valid Palindrome
3. Remove Duplicates from Sorted Array
4. Move Zeroes
5. Squares of a Sorted Array
6. Container With Most Water
7. 3Sum
8. Trapping Rain Water

Do not just solve them. After each one, write down:

- what each pointer meant
- why each move was safe
- the time and space complexity

That reflection is what helps the pattern stick.

## Interview Script You Can Reuse

If you spot the pattern, you can explain it like this:

```text
Because the array is sorted, I can place one pointer at each end.
If the current sum is too small, I move the left pointer right to increase it.
If the sum is too large, I move the right pointer left to decrease it.
That lets me scan the array once in O(n) time with O(1) extra space.
```

That is short, logical, and persuasive.

## Final Takeaways

- two pointers is a way to avoid repeated work
- sorted data often makes the pattern possible
- opposite-direction pointers are great for pair and palindrome problems
- same-direction pointers are great for in-place compaction
- always explain why each pointer move is safe
- compare it with brute force so the improvement is obvious

This is one of the highest-value DSA patterns to master early because it keeps showing up under different names.

## Read Next

- [DSA in Java Series](/blog/category/dsa/)
- [Big-O Notation in Java](/blog/big-o-notation-java-interview-problem-solving/)
- [Java Design Patterns: When to Use Them, When to Avoid Them](/blog/java-design-patterns/)
