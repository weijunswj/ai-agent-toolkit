### Fixes

- Page large comment traces directly into bounded directory comments with a separate line per topic, preventing notification floods while retaining hand-written prose and decision links. Small moves use at most five topic comments per pass. Interrupted passes verify and reuse pages. Generated indexes reject missing, cyclic or unrelated links within two hops; hand-made indexes retain their one-hop reading and ignore foreign references.
