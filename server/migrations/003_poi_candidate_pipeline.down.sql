DROP INDEX IF EXISTS poi_candidates_suggestion_idx;
DROP INDEX IF EXISTS poi_candidates_location_idx;
DROP INDEX IF EXISTS poi_candidates_queue_idx;
DROP INDEX IF EXISTS poi_import_batches_area_created_idx;

DROP TABLE IF EXISTS poi_import_batch_items;
DROP TABLE IF EXISTS poi_candidates;
DROP TABLE IF EXISTS poi_import_batches;

DROP TYPE IF EXISTS poi_candidate_status;
