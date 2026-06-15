-- Clear operational data (keeps users, factory/line seed, sizes, contractors, OTA releases).
TRUNCATE TABLE
  count_samples,
  sessions,
  scan_events,
  unassigned_counts,
  heartbeats,
  ota_events,
  alerts,
  device_tokens,
  bundles,
  cards,
  nodes,
  ppp_calibration
RESTART IDENTITY CASCADE;
