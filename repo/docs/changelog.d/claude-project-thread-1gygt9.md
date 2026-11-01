### Changed

- Projects: every project now runs 1 working lane by default, with one extra lane always kept free for the owner's sudden asks. The owner sets another number with one project line outside the managed block, and an existing lane cap line still counts. Work waiting on the owner no longer counts, so the coordinator starts the next item instead of idling.
- Projects posts: one blank line between labelled blocks, the problem, fix and skip lines nested as bullets under Now, thread links titled by the thread's name, and every open owner ask carried into a fresh post. Once the owner writes after a post, that post is never edited again.
- Projects setup records a lane line only when the owner gives a number, and an instructions sync that brings in the 1-lane default says so once in its note.
- Projects links: posts link the chat thread that owns the work, UAT asks included. A direct PR link appears only on a merge ask for a merge-ready PR, and the hourly nudge flags any other PR link.
- Projects posts: choices under a question are lettered (a., b.) because the owner picks one, and a device is named by the name the project instructions record for it.
- Projects coordinator: relays every daily check-in and hourly nudge report with the waiting-on-you list, and keeps each owed decision-trace record on the promise list until it is posted and read back.
- Projects posts: **Waiting on you** sits second last, just above the ELI5 line, which always ends the post.
- Projects posts: every time shown to the owner, Update stamps included, uses the owner's profile time zone, never UTC.
- Projects hourly nudge: flags a post whose ELI5 line is not last, whose Waiting on you list is not just above it, or whose Update stamps are not in the owner's time zone.
- Projects daily check-in and hourly nudge: their reports give times in the owner's profile time zone; only their state files keep UTC.
- Projects posts: **Waiting on you** lists only items the owner can act on right now; work still being built or reviewed stays off it, and the hourly nudge flags any that slip on.
