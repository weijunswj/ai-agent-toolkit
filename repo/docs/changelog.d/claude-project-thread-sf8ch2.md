Title: robust page refresh

### Changed

- **Cloud sweep request cap:** a scheduled sweep on GitHub sends at most 1,500 requests, what fits in half its 50-minute budget at about a second a request, so a full pass leaves half its time for a slow GitHub. It still stops earlier when GitHub's remaining hourly count for the governance App reaches the safety margin. A pass stopped at the cap saves its place and starts its follow-up run at once, so a big board keeps draining. The run summary shows the cap as a number.

### Fixed

- **Two or more comments on one page in one pass:** GitHub moves an issue's update time to that of any comment posted or edited on it, so the page writer took its own archive or index comment for someone else's edit, stopped with `BODY_MOVED`, and left the page for the next pass. It now tells this pass's own comment times apart: a page whose body is unchanged and whose update time is exactly one of its own comments' times is written in the same pass. A person's comment or body edit in between still holds the page.

### Added

- **Refresh failure suite:** tests for GitHub slowness, the hour's allowance running out mid-run, a page edited mid-run, a stop in every queue phase and mid-way through the task pages, and two or more comments on one page. Each ends in a resumed run that completes every page, plus a loud finding or hold. The test fake now moves an issue's update time on every comment post and edit, as GitHub does.
