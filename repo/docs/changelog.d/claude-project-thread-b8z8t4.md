### Changed

- **The programme page has three generated parts:** CURRENT, PROGRAMME GRAPH and AGENT CONTEXT, then the hand-written text. The DECISIONS block, which nothing read and which linked only the newest decision comment, is gone. A page that still has one reads as before and loses it on the next write, keeping the text around it byte for byte.
- **AGENT CONTEXT links the full decision index:** its Decisions part now links every top-level decision index comment on the parent, oldest first (`index`, or `index 1` to `index n`; a directory comment stands for its parts), before `programme.cjs trace <n>`. Bot and archive comments never count, as in the trace audit. The body itself therefore reaches every record an index lists, so hand-written index links on the page can later move to an archive comment without leaving records unlinked.
- The Programme Graph's order line no longer says "optional tasks after the rest": optional tasks show as LATER.
