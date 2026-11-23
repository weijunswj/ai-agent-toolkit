### Fixed

- The controller's stale check no longer shows rows that a newer programme read has overtaken. A stamp written just after local midnight from a sweep late on the previous UTC day used to be replayed for the whole local day without a read, so children closed since stayed listed. A stamp now stands only while it names this local date, is under a day old by its own time and no programme read on this computer is newer than the one it was made from; otherwise the check reads again, and the session-start line shows no rows and starts it in the background.
