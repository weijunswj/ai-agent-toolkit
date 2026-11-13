Title: merge train by default

### Changed

- Controllers now land two or more merge-ready pull requests as one merge train on their own, instead of merging them one at a time. The Controller routes its merge step to the page that holds the train rule, the Claude Projects skill puts the train ahead of the one-PR bump route, and the hourly nudge flags ready pull requests that should ride together. A single pull request, or one a train ejected, still merges alone.
