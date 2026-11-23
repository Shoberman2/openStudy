# Asymptotic notation
Big O is an upper bound on how fast a function grows for large inputs.
Big Omega is a lower bound on how fast a function grows for large inputs.
Big Theta is a bound matching upper and lower bounds up to constant factors.
When I double the input, a quadratic term grows by a factor of four.

# Binary search
Binary search is a lookup method that eliminates half of a sorted range at each step.
Search interval is the range of indices where the target can still be.
Loop invariant is a claim that remains true before and after every iteration.
If the midpoint value is smaller than the target, move the left boundary past the midpoint.

# Merge sort
Merge sort is a divide and conquer algorithm that sorts halves and then combines them.
Merge step is the linear pass that combines two sorted lists.
Stable sort is a sort that preserves the input order of records with equal keys.
Merge sort takes O(n log n) time because there is linear work at each of logarithmically many levels.

# Heaps
Min heap is a complete binary tree where each parent is at most its children.
Heap invariant is the rule that a parent's key never exceeds its children's keys in a min heap.
heapq.heappush(h, x) adds x to the heap and repairs its ordering.
heapq.heappop(h) removes and returns the smallest item in the heap.

# Hashing
Hash function is a function that maps a key to an array slot.
Collision is when two distinct keys map to the same slot.
Separate chaining is a strategy that stores colliding keys in a collection at their slot.
Load factor is the number of stored entries divided by the table capacity.

# BFS and DFS
Breadth first search is a graph traversal that visits vertices in increasing distance from a source.
Depth first search is a graph traversal that follows a branch before it backtracks.
The frontier is the set of discovered vertices that are still waiting to be explored.
queue.popleft() removes the oldest entry from the left side of the deque.

# Dijkstra
Dijkstra's algorithm is a method for single source shortest paths with nonnegative edge weights.
Edge relaxation is the process of updating a distance estimate when a route through an edge is shorter.
Settled vertex is a vertex whose distance estimate has become its final shortest distance.
A shortest path can go through more edges if their total weight is lower.

# Dynamic programming
Subproblem is a smaller instance whose result contributes to solving the larger problem.
Memoization is a top down approach that caches computed results as they are needed.
Tabulation is a bottom up approach that computes results in dependency order.
Base case is a subproblem whose answer is known without a recurrence.
