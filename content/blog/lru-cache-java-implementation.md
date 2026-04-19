---
title: "LRU Cache Implementation in Java: $O(1)$ Strategy"
description: "Master the Least Recently Used (LRU) cache implementation in Java. Learn how to combine a HashMap with a Doubly Linked List to achieve constant time complexity for both get and put operations."
date: "2026-04-19"
category: "DSA"
tags: ["dsa", "java", "cache", "lru", "hashmap", "doubly linked list", "interview preparation"]
featured: false
affiliateSection: "java-courses"
---

The **LRU (Least Recently Used) Cache** is one of the most popular interview questions because it tests your ability to design a custom data structure. It requires you to maintain a fixed-size cache and, when full, evict the item that hasn't been used for the longest time.

To achieve **$O(1)$ time complexity** for both `get` and `put`, you need a hybrid approach:
1. **HashMap**: For $O(1)$ lookups.
2. **Doubly Linked List**: To maintain the order of usage in $O(1)$ time.

---

## Why a Doubly Linked List?

A regular array or `ArrayList` would require $O(n)$ to move an element to the front. A Doubly Linked List allows us to:
- Remove any node in $O(1)$ (if we have a reference to it).
- Add a node to the front (Most Recently Used) in $O(1)$.
- Remove from the tail (Least Recently Used) in $O(1)$.

---

## LRU Cache Implementation in Java

```java
import java.util.*;

class LRUCache {
    class Node {
        int key, value;
        Node prev, next;
        Node(int k, int v) { key = k; value = v; }
    }

    private Map<Integer, Node> map;
    private int capacity;
    private Node head, tail;

    public LRUCache(int capacity) {
        this.capacity = capacity;
        this.map = new HashMap<>();
        // Use dummy head and tail to simplify edge cases
        head = new Node(0, 0);
        tail = new Node(0, 0);
        head.next = tail;
        tail.prev = head;
    }

    public int get(int key) {
        if (map.containsKey(key)) {
            Node node = map.get(key);
            remove(node);
            insertToFront(node);
            return node.value;
        }
        return -1;
    }

    public void put(int key, int value) {
        if (map.containsKey(key)) {
            remove(map.get(key));
        }
        if (map.size() == capacity) {
            remove(tail.prev);
        }
        insertToFront(new Node(key, value));
    }

    private void remove(Node node) {
        map.remove(node.key);
        node.prev.next = node.next;
        node.next.prev = node.prev;
    }

    private void insertToFront(Node node) {
        map.put(node.key, node);
        node.next = head.next;
        node.next.prev = node;
        head.next = node;
        node.prev = head;
    }
}
```

---

## Alternative: Using `LinkedHashMap`

In a real-world Java project, you wouldn't build this from scratch. Java's `LinkedHashMap` actually provides this functionality out of the box.

```java
import java.util.LinkedHashMap;
import java.util.Map;

class SimpleLRUCache<K, V> extends LinkedHashMap<K, V> {
    private final int capacity;

    public SimpleLRUCache(int capacity) {
        // 'true' for access-order (LRU behavior)
        super(capacity, 0.75f, true);
        this.capacity = capacity;
    }

    @Override
    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > capacity;
    }
}
```

## Summary

The manual implementation using a HashMap and Doubly Linked List is the preferred answer in interviews because it demonstrates your understanding of pointer manipulation and data structure composition. It is the gold standard for balancing search speed with ordering efficiency.
