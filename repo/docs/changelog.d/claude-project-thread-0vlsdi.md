### Added

- External operation preflight keeps the recovery identity of a temporary outside resource that later sessions depend on. A new offline script claims the exact name before creating, records the provider's handle from its read-back, lets a fresh session resolve and check that one resource, and deletes the record only after a read-back shows the resource gone. It keeps one record per resource: a resource or handle another key already holds is refused, and two sessions claiming at once cannot both win. A missing, half-done, damaged or mismatched record holds the work.
