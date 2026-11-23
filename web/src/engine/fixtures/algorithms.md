# Binary Search

Binary search finds an item in a sorted list by repeatedly halving the search range.
Binary search runs in O(log n) time because each step cuts the remaining list in half.
Simple search checks every element one by one, so it takes O(n) time.
Binary search only works when the list is sorted.
With a list of 1,024 items, binary search needs at most 10 steps.

# Big O Notation

Big O notation describes how the running time of an algorithm grows as the input grows.
Big O establishes a worst case run time for an algorithm.
An O(n log n) algorithm like merge sort is faster than an O(n^2) algorithm like selection sort for large inputs.
The traveling salesperson problem has a brute force solution that takes O(n!) time.
Constants are dropped in Big O, so O(2n) is written as O(n).

# Sorting and Recursion

Selection sort repeatedly finds the smallest remaining element and moves it to the front.
Every recursive function has a base case and a recursive case.
The base case stops the recursion, so the function does not call itself forever.
Quicksort picks a pivot and partitions the array into elements smaller and larger than the pivot.
Quicksort takes O(n log n) time on average but O(n^2) time in the worst case.
Merge sort splits the array in half, sorts each half, then merges the two sorted halves.
The call stack stores information about active function calls, which is why deep recursion can use a lot of memory.
