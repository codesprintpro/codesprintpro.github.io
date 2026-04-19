---
title: "Huffman Coding in Java: Lossless Data Compression"
description: "Master the Huffman Coding algorithm in Java. Learn how to use a Greedy approach and a PriorityQueue to build an optimal prefix-free code for data compression."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "algorithms", "huffman coding", "compression", "greedy", "interview preparation"]
featured: false
affiliateSection: "java-courses"
---

**Huffman Coding** is a classic greedy algorithm used for lossless data compression. It assigns variable-length codes to input characters, with shorter codes assigned to more frequent characters.

This is the foundation of many compression formats like **ZIP** and **JPEG**.

## The Core Concept: Greedy Tree Building

Huffman coding works by building a binary tree from the bottom up.

**The Logic**:
1. Calculate the frequency of each character in the input string.
2. Create a "Leaf Node" for each character and add it to a **Min-Heap (PriorityQueue)**.
3. While there is more than one node in the heap:
   - Extract the two nodes with the lowest frequencies.
   - Create a new "Internal Node" with these two nodes as children and a frequency equal to the sum of their frequencies.
   - Add this new node back to the heap.
4. The remaining node in the heap is the root of the Huffman Tree.
5. Traverse the tree to assign codes: `0` for left branch, `1` for right branch.

---

## Huffman Coding Implementation in Java

```java
import java.util.*;

class HuffmanNode implements Comparable<HuffmanNode> {
    int freq;
    char c;
    HuffmanNode left, right;

    HuffmanNode(char c, int freq) {
        this.c = c;
        this.freq = freq;
    }

    @Override
    public int compareTo(HuffmanNode other) {
        return Integer.compare(this.freq, other.freq);
    }
}

public class HuffmanCoding {
    public Map<Character, String> buildCodes(String text) {
        // 1. Count frequencies
        Map<Character, Integer> freqMap = new HashMap<>();
        for (char c : text.toCharArray()) freqMap.put(c, freqMap.getOrDefault(c, 0) + 1);

        // 2. Build Min-Heap
        PriorityQueue<HuffmanNode> pq = new PriorityQueue<>();
        for (var entry : freqMap.entrySet()) {
            pq.add(new HuffmanNode(entry.getKey(), entry.getValue()));
        }

        // 3. Build Huffman Tree
        while (pq.size() > 1) {
            HuffmanNode left = pq.poll();
            HuffmanNode right = pq.poll();
            HuffmanNode parent = new HuffmanNode('-', left.freq + right.freq);
            parent.left = left;
            parent.right = right;
            pq.add(parent);
        }

        // 4. Generate Codes
        Map<Character, String> huffmanCodes = new HashMap<>();
        generateCodes(pq.poll(), "", huffmanCodes);
        return huffmanCodes;
    }

    private void generateCodes(HuffmanNode node, String code, Map<Character, String> map) {
        if (node == null) return;
        if (node.left == null && node.right == null) {
            map.put(node.c, code);
        }
        generateCodes(node.left, code + "0", map);
        generateCodes(node.right, code + "1", map);
    }
}
```

---

## Why use Huffman Coding?

| Feature | Fixed-Length Code (ASCII) | Huffman Coding |
|---|---|---|
| **Space** | 8 bits per character | Variable (Frequent = Small) |
| **Prefix-Free** | Naturally | Guaranteed by Tree structure |
| **Efficiency** | Poor for uneven frequencies | Optimal for any frequency distribution |

## Important Property: Prefix-Free

A key property of Huffman codes is that they are **prefix-free**. This means no code is a prefix of any other code (e.g., if 'a' is `01`, no other character can start with `01`). This allows for unambiguous decoding without any separators between characters.

## Summary

Huffman Coding is a beautiful example of how a simple greedy strategy can produce an mathematically optimal solution for data representation. In an interview, it demonstrates your ability to combine frequency analysis, tree traversal, and the efficient use of Priority Queues to solve real-world efficiency challenges.
