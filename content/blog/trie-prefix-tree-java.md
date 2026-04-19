---
title: "Mastering the Trie (Prefix Tree) in Java: Efficient String Search"
description: "Learn how to implement and use a Trie (Prefix Tree) in Java. Understand why it's faster than a Hash Table for prefix lookups and how to use it for autocomplete and spell-check features."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "trie", "prefix tree", "strings", "interview preparation", "algorithms"]
featured: false
affiliateSection: "java-courses"
---

A **Trie**, also known as a **Prefix Tree**, is a specialized tree-based data structure used to store and search strings efficiently.

While a Hash Table can find a whole word in $O(L)$ time (where $L$ is word length), a Trie can do the same *plus* efficiently handle prefix-based queries like "find all words starting with 'apple'". This makes it the engine behind features like **autocomplete**, **spell-checkers**, and **IP routing**.

## How a Trie Works

Instead of storing each word as a single blob, a Trie stores characters as nodes in a tree.
- The root is usually empty.
- Each node represents a single character.
- Words share common prefixes (e.g., "apple" and "apply" share the same first 4 characters).
- Each node has a boolean flag `isEndOfWord` to indicate if a word terminates at that character.

---

## Implementing a Trie in Java

### 1. The TrieNode Structure

```java
class TrieNode {
    TrieNode[] children;
    boolean isEndOfWord;

    public TrieNode() {
        // For lowercase English letters (a-z)
        children = new TrieNode[26];
        isEndOfWord = false;
    }
}
```

### 2. The Trie Class (Insert and Search)

```java
public class Trie {
    private TrieNode root;

    public Trie() {
        root = new TrieNode();
    }

    // Insert a word into the trie
    public void insert(String word) {
        TrieNode current = root;
        for (char ch : word.toCharArray()) {
            int index = ch - 'a'; // Map 'a' to 0, 'b' to 1, etc.
            if (current.children[index] == null) {
                current.children[index] = new TrieNode();
            }
            current = current.children[index];
        }
        current.isEndOfWord = true;
    }

    // Search for a word
    public boolean search(String word) {
        TrieNode node = getNode(word);
        return node != null && node.isEndOfWord;
    }

    // Check if any word starts with the given prefix
    public boolean startsWith(String prefix) {
        return getNode(prefix) != null;
    }

    private TrieNode getNode(String str) {
        TrieNode current = root;
        for (char ch : str.toCharArray()) {
            int index = ch - 'a';
            if (current.children[index] == null) return null;
            current = current.children[index];
        }
        return current;
    }
}
```

---

## When to use a Trie over a Hash Table?

| Feature | Hash Table | Trie |
|---|---|---|
| **Search Time** | $O(L)$ average | $O(L)$ guaranteed |
| **Prefix Search** | Not supported (requires full scan) | $O(P)$ where $P$ is prefix length |
| **Alphabetical Order** | Requires sorting | Naturally sorted via DFS traversal |
| **Space** | Sparse for short words | Can be high due to child pointers |

## Real-World Applications

1. **Autocomplete Systems**: When you type in a search bar, a Trie quickly finds all words sharing that prefix.
2. **Longest Prefix Matching**: Used in network routers to find the best route for an IP address.
3. **Spell Checkers**: Tries can verify word existence and suggest alternatives by exploring neighboring branches.
4. **T9 Predictive Text**: (The old way we typed on phone keypads!)

## Summary

The Trie is a powerful example of trading space for speed. While it can consume more memory than a list of strings, its ability to perform prefix lookups and alphabetical traversals makes it indispensable for string-heavy systems and high-tier coding interviews.
