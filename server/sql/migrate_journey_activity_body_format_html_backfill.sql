-- Backfill: correct body_format on journey email activities whose body is HTML.
--
-- client_journey_activities.body_format defaults to 'text' at the DB level, while every
-- journey email body is authored in the RichTextEditor (HTML). Rows that weren't
-- explicitly stamped 'html' therefore carried body_format='text' with an HTML body. The
-- send path now renders those correctly regardless (see sendJourneyEmailNow), but the
-- stored value still drives the in-app timeline/preview, so align the data with reality.
--
-- Only touches email-type rows whose body actually contains HTML markup. Idempotent:
-- after the first run no rows match (body_format is already 'html'), so re-running on
-- every server start is a cheap no-op.
UPDATE client_journey_activities
   SET body_format = 'html'
 WHERE type = 'email'
   AND body_format IS DISTINCT FROM 'html'
   AND body ~* '<[a-z!/][^>]*>';
